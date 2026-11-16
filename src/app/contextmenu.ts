import { NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import type { Node as PMNode, Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import type { MathfieldElement } from 'mathlive';
import { h, keepFocus } from './dom';
import { readClipboard, writeClipboard } from './clipboard';
import { isDesktop } from './platform';
import { focusMathfield, getActiveMathfield } from '../math/mathfield';
import { cleanLatex } from '../export/mathconv';
import { latexToPng, svgToPng } from '../export/image';
import { drawingSvg, type DrawingAttrs } from '../editor/drawing';

/**
 * Right-click menu for the document: Cut / Copy / Paste everywhere, plus
 * Copy LaTeX / Copy as image for equations and Copy as image for drawings.
 */

export interface ContextMenuDeps {
  /** Open the LaTeX source editor for the equation at `pos`. */
  editLatex: (pos: number) => void;
  /** Show a short message in the status bar. */
  notice: (msg: string) => void;
}

interface Item {
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void | Promise<void>;
}
type Entry = Item | 'sep';

const mod = isDesktop && navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';

let openMenu: HTMLElement | null = null;

function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}

function showMenu(x: number, y: number, entries: Entry[], notice: (m: string) => void) {
  closeMenu();
  const menu = h('div.ctx-menu', { role: 'menu' });
  keepFocus(menu);
  for (const e of entries) {
    if (e === 'sep') {
      menu.append(h('div.ctx-sep', { role: 'separator' }));
      continue;
    }
    menu.append(
      h(
        'button.ctx-item',
        {
          role: 'menuitem',
          class: e.danger ? 'ctx-item danger' : 'ctx-item',
          disabled: !!e.disabled,
          onclick: async () => {
            closeMenu();
            try {
              await e.run();
            } catch (err) {
              console.error(err);
              notice(`${e.label} failed: ${(err as Error)?.message ?? err}`);
            }
          },
        },
        h('span', {}, e.label),
        e.hint ? h('span.ctx-hint', {}, e.hint) : null,
      ),
    );
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, y + r.height > innerHeight - 4 ? y - r.height : y)}px`;
  openMenu = menu;
  const onDown = (ev: Event) => {
    if (!menu.contains(ev.target as Node)) cleanup();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      cleanup();
    }
  };
  const cleanup = () => {
    closeMenu();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', cleanup);
    window.removeEventListener('resize', cleanup);
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', cleanup);
  window.addEventListener('resize', cleanup);
}

/** Find the document node whose node-view DOM is `el`. */
function nodeForDom(view: EditorView, el: Element): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isAtom && view.nodeDOM(pos) === el) found = { node, pos };
    return !found;
  });
  return found;
}

/** LaTeX inside clipboard content (our own copies, KaTeX/MathJax pages, or `$…$` text). */
function latexFromClipboard(html: string, text: string): string {
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const parts = [...doc.querySelectorAll<HTMLElement>('[data-latex]')].map((e) => e.dataset.latex ?? '');
    const ann = [...doc.querySelectorAll('annotation[encoding="application/x-tex"]')].map((a) => a.textContent ?? '');
    if (parts.length || ann.length) return [...parts, ...ann].join(' ');
  }
  const t = text.trim();
  const m = t.match(/^\$\$([\s\S]*)\$\$$/) ?? t.match(/^\$([\s\S]*)\$$/) ?? t.match(/^\\\(([\s\S]*)\\\)$/) ?? t.match(/^\\\[([\s\S]*)\\\]$/);
  return m ? m[1].trim() : t;
}

export function installContextMenu(view: EditorView, deps: ContextMenuDeps) {
  const copySlice = async (slice: Slice) => {
    const { dom, text } = view.serializeForClipboard(slice);
    await writeClipboard({ html: dom.innerHTML, text });
  };

  const paste = async () => {
    const { html, text } = await readClipboard();
    if (!html && !text) {
      deps.notice('The clipboard is empty.');
      return;
    }
    view.focus();
    if (html) view.pasteHTML(html);
    else view.pasteText(text);
  };

  const pasteIntoMathfield = async (mf: MathfieldElement) => {
    const { html, text } = await readClipboard();
    const latex = latexFromClipboard(html, text);
    if (!latex) return;
    focusMathfield(mf);
    mf.insert(latex, { format: 'latex', selectionMode: 'after', focus: true });
  };

  /** Put the text cursor just after an atom node (inline or block). */
  const caretAfter = (pos: number, node: PMNode) => {
    const { state } = view;
    const end = pos + node.nodeSize;
    const sel = node.isInline ? TextSelection.create(state.doc, end) : Selection.near(state.doc.resolve(end), 1);
    view.dispatch(state.tr.setSelection(sel));
  };

  const selectNode = (pos: number) => {
    getActiveMathfield()?.blur();
    view.focus();
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  };

  const deleteNode = (pos: number, node: PMNode) => {
    view.focus();
    view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize).scrollIntoView());
  };

  function equationMenu(pos: number, node: PMNode, mfEl: MathfieldElement | null): Entry[] {
    const latex = node.attrs.latex as string;
    const display = node.type.name === 'math_display';
    const slice = () => NodeSelection.create(view.state.doc, pos).content();
    const editing = mfEl && getActiveMathfield() === mfEl;
    return [
      { label: 'Cut', hint: `${mod}X`, run: async () => { await copySlice(slice()); deleteNode(pos, node); } },
      { label: 'Copy', hint: `${mod}C`, run: () => copySlice(slice()) },
      {
        label: 'Paste',
        hint: `${mod}V`,
        run: async () => {
          if (editing && mfEl) return pasteIntoMathfield(mfEl);
          getActiveMathfield()?.blur();
          view.focus();
          caretAfter(pos, node);
          await paste();
        },
      },
      'sep',
      {
        label: 'Copy LaTeX',
        run: async () => {
          await writeClipboard({ text: cleanLatex(latex) });
          deps.notice('LaTeX copied');
        },
      },
      {
        label: 'Copy as image',
        disabled: !cleanLatex(latex),
        run: async () => {
          await writeClipboard({ png: latexToPng(latex, display) });
          deps.notice('Equation copied as an image');
        },
      },
      'sep',
      { label: 'Edit LaTeX…', run: () => { selectNode(pos); deps.editLatex(pos); } },
      { label: 'Delete equation', danger: true, run: () => deleteNode(pos, node) },
    ];
  }

  function drawingMenu(pos: number, node: PMNode): Entry[] {
    const slice = () => NodeSelection.create(view.state.doc, pos).content();
    return [
      { label: 'Cut', hint: `${mod}X`, run: async () => { await copySlice(slice()); deleteNode(pos, node); } },
      { label: 'Copy', hint: `${mod}C`, run: () => copySlice(slice()) },
      { label: 'Paste', hint: `${mod}V`, run: async () => { caretAfter(pos, node); await paste(); } },
      'sep',
      {
        label: 'Copy as image',
        run: async () => {
          const a = node.attrs as DrawingAttrs;
          await writeClipboard({ png: svgToPng(drawingSvg(a), a.width, a.height, 2, '#fff') });
          deps.notice('Drawing copied as an image');
        },
      },
      { label: 'Delete drawing', danger: true, run: () => deleteNode(pos, node) },
    ];
  }

  function textMenu(e: MouseEvent): Entry[] {
    // Right-clicking outside the selection moves the cursor there first (like Word).
    const { state } = view;
    const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
    const sel = state.selection;
    if (at && (sel.empty || at.pos < sel.from || at.pos > sel.to)) {
      view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(at.pos))));
    }
    view.focus();
    const empty = view.state.selection.empty;
    return [
      {
        label: 'Cut',
        hint: `${mod}X`,
        disabled: empty,
        run: async () => {
          await copySlice(view.state.selection.content());
          view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
        },
      },
      { label: 'Copy', hint: `${mod}C`, disabled: empty, run: () => copySlice(view.state.selection.content()) },
      { label: 'Paste', hint: `${mod}V`, run: paste },
    ];
  }

  // Capture phase, so MathLive's own menu (on the mathfield) never opens.
  view.dom.addEventListener(
    'contextmenu',
    (e) => {
      const target = e.target as HTMLElement;
      const mathEl = target.closest('.math-inline, .math-display');
      const drawEl = target.closest('.drawing-anchor');
      let entries: Entry[];
      if (mathEl) {
        const found = nodeForDom(view, mathEl);
        if (!found) return;
        entries = equationMenu(found.pos, found.node, mathEl.querySelector('math-field'));
      } else if (drawEl) {
        if (target.closest('.drawing-toolbar')) return;
        const found = nodeForDom(view, drawEl);
        if (!found) return;
        entries = drawingMenu(found.pos, found.node);
      } else {
        entries = textMenu(e);
      }
      e.preventDefault();
      e.stopPropagation();
      showMenu(e.clientX, e.clientY, entries, deps.notice);
    },
    true,
  );
}
