import type { Node as PMNode } from 'prosemirror-model';
import { Selection, TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { MathfieldElement } from 'mathlive';
import { createMathfield, focusMathfield, releaseMathfield } from '../math/mathfield';

/** Hooks the app installs so mathfields can trigger app-level behaviour. */
export const mathHooks = {
  /** Return true when an overlay (quick search, dialog) currently owns focus. */
  overlayOpen: () => false,
  /** Called on contextmenu/edit-source requests from a math node. */
  editSource: (_view: EditorView, _pos: number) => {},
};

const views = new WeakMap<HTMLElement, MathView>();

export class MathView implements NodeView {
  dom: HTMLElement;
  mf: MathfieldElement;
  private node: PMNode;
  private display: boolean;
  private updating = false;
  private mounted = false;
  private readyQueue: (() => void)[] = [];

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.node = node;
    this.display = node.type.name === 'math_display';
    this.dom = document.createElement(this.display ? 'div' : 'span');
    this.dom.className = this.display ? 'math-display' : 'math-inline';
    this.dom.dataset.numbered = String(!!node.attrs.numbered);
    this.dom.contentEditable = 'false';

    this.mf = createMathfield(this.display);
    this.mf.value = node.attrs.latex;
    this.dom.appendChild(this.mf);
    views.set(this.dom, this);

    this.mf.addEventListener('mount', () => {
      this.mounted = true;
      const queued = this.readyQueue.splice(0);
      queued.forEach((fn) => fn());
    });
    this.mf.addEventListener('input', this.onInput);
    this.mf.addEventListener('move-out', this.onMoveOut as EventListener);
    this.mf.addEventListener('keydown', this.onKeyDown, { capture: true });
    this.mf.addEventListener('focusout', this.onFocusOut);
  }

  // ---- ProseMirror NodeView interface ------------------------------------

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.dom.dataset.numbered = String(!!node.attrs.numbered);
    if (!this.updating && node.attrs.latex !== this.mf.value) {
      this.mf.setValue(node.attrs.latex, { silenceNotifications: true });
    }
    return true;
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  /** Let the mathfield handle all of its own events. */
  stopEvent(event: Event) {
    const t = event.target as Node | null;
    if (event.type === 'dragstart' && t === this.dom) return false;
    return !!t && (t === this.mf || this.mf.contains(t));
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.mf.removeEventListener('input', this.onInput);
    releaseMathfield(this.mf);
  }

  // ---- Focus helpers ------------------------------------------------------

  /** Run `fn` once MathLive has mounted the mathfield (immediately if it already has). */
  whenReady(fn: () => void) {
    if (this.mounted) fn();
    else this.readyQueue.push(fn);
  }

  focus(where: 'start' | 'end' | 'keep' = 'end', then?: (mf: MathfieldElement) => void) {
    // MathLive takes focus asynchronously (a frame or more after mounting).
    // Hold keystrokes typed in the meantime instead of letting them land in the
    // surrounding text, then replay them into the equation.
    const buffer: string[] = [];
    const dom = this.view.dom;
    const onBeforeInput = (e: Event) => {
      const ie = e as InputEvent;
      e.preventDefault();
      if (ie.inputType === 'insertText' && ie.data) buffer.push(ie.data);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (['Enter', 'Backspace', 'Delete', 'Tab'].includes(e.key)) e.preventDefault();
    };
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dom.removeEventListener('beforeinput', onBeforeInput, true);
      dom.removeEventListener('keydown', onKeyDown, true);
      if (where === 'start') this.mf.executeCommand('moveToMathfieldStart');
      else if (where === 'end') this.mf.executeCommand('moveToMathfieldEnd');
      then?.(this.mf);
      for (const ch of buffer.join('')) {
        this.mf.executeCommand(['typedText', ch, { focus: true, feedback: false, simulateKeystroke: false }]);
      }
    };
    dom.addEventListener('beforeinput', onBeforeInput, true);
    dom.addEventListener('keydown', onKeyDown, true);
    this.whenReady(() => {
      focusMathfield(this.mf);
      // MathLive's hasFocus() turns true before the browser focus actually moves,
      // so check the real active element.
      if (document.activeElement === this.mf) finish();
      else {
        this.mf.addEventListener('focusin', finish, { once: true });
        setTimeout(finish, 400); // never hold the keyboard hostage
      }
    });
  }

  // ---- Mathfield events ---------------------------------------------------

  private onInput = () => {
    const pos = this.getPos();
    if (pos == null) return;
    const latex = this.mf.value;
    if (latex === this.node.attrs.latex) return;
    this.updating = true;
    try {
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, latex });
      tr.setMeta('mathEdit', true);
      this.view.dispatch(tr);
    } finally {
      this.updating = false;
    }
  };

  /** Arrow/Tab past the edge of the mathfield → put the text cursor beside the node. */
  private onMoveOut = (ev: CustomEvent<{ direction: 'forward' | 'backward' | 'upward' | 'downward' }>) => {
    const dir = ev.detail.direction;
    // Inline math ignores up/down so the mathfield can use them for fractions etc.
    if (!this.display && (dir === 'upward' || dir === 'downward')) return;
    ev.preventDefault();
    this.exit(dir === 'forward' || dir === 'downward' ? 1 : -1);
  };

  exit(dir: 1 | -1) {
    const pos = this.getPos();
    if (pos == null) return;
    const { state } = this.view;
    let tr = state.tr;
    let target = dir > 0 ? pos + this.node.nodeSize : pos;
    if (this.display) {
      // Make sure there is a paragraph to land in.
      const $t = tr.doc.resolve(target);
      const neighbour = dir > 0 ? $t.nodeAfter : $t.nodeBefore;
      if (!neighbour || !neighbour.isTextblock) {
        // No text to land in: create an empty paragraph on that side.
        tr = tr.insert(target, state.schema.nodes.paragraph.create());
        target += 1;
      } else {
        target += dir > 0 ? 1 : -1;
      }
      tr.setSelection(TextSelection.create(tr.doc, target));
    } else {
      tr.setSelection(Selection.near(tr.doc.resolve(target), dir));
    }
    this.mf.blur();
    this.view.focus();
    this.view.dispatch(tr.scrollIntoView());
  }

  private deleteSelf() {
    const pos = this.getPos();
    if (pos == null) return;
    const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
    this.view.focus();
    this.view.dispatch(tr);
  }

  private onKeyDown = (ev: KeyboardEvent) => {
    const empty = this.mf.value.trim() === '';
    if ((ev.key === 'Backspace' || ev.key === 'Delete') && empty) {
      ev.preventDefault();
      ev.stopPropagation();
      this.deleteSelf();
      return;
    }
    // Enter leaves the math (Shift+Enter in display math adds a new row instead).
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      ev.stopPropagation();
      this.exit(1);
      return;
    }
    // Escape leaves the mathfield, unless MathLive is in LaTeX-entry mode
    // (after typing `\`), where Escape finishes the command instead.
    if (ev.key === 'Escape' && this.mf.mode !== 'latex') {
      ev.preventDefault();
      this.exit(1);
    }
  };

  private onFocusOut = () => {
    // Remove math nodes the user left empty, unless focus went to our own UI.
    setTimeout(() => {
      if (!this.mf.isConnected || this.mf.hasFocus() || mathHooks.overlayOpen()) return;
      if (this.mf.value.trim() === '') {
        const pos = this.getPos();
        if (pos == null) return;
        this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
      }
    }, 0);
  };
}

/** Find the MathView for the math node at `pos`. */
export function mathViewAt(view: EditorView, pos: number): MathView | null {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? (views.get(dom) ?? null) : null;
}

export const mathNodeViews = {
  math_inline: (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
    new MathView(node, view, getPos),
  math_display: (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
    new MathView(node, view, getPos),
};
