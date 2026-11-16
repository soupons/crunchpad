import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, exitCode } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
  smartQuotes,
  emDash,
  ellipsis,
} from 'prosemirror-inputrules';
import { schema } from './schema';
import { mathViewAt } from './mathview';
import { templateForCommand } from '../math/catalog';
import { hasMathDelimiters, sliceFromText } from './textmath';

const { nodes } = schema;

// ---- Deferred focusing of newly created math nodes -------------------------
// Input rules can't reach the view, so they leave a note that a plugin view
// picks up right after the DOM is updated.

interface PendingFocus {
  node: PMNode;
  insert?: string;
}
let pendingFocus: PendingFocus | null = null;

const focusPlugin = new Plugin({
  key: new PluginKey('math-focus'),
  view: () => ({
    update(view) {
      if (!pendingFocus) return;
      const { node, insert } = pendingFocus;
      pendingFocus = null;
      let pos: number | null = null;
      view.state.doc.descendants((n, p) => {
        if (pos != null) return false;
        if (n === node) pos = p;
        return true;
      });
      if (pos == null) return;
      const mv = mathViewAt(view, pos);
      if (!mv) return;
      mv.focus('end', (mf) => {
        if (insert) mf.insert(insert, { format: 'latex', selectionMode: 'placeholder', focus: true });
      });
    },
  }),
});

// ---- Input rules -----------------------------------------------------------

/** `$x^2$` → inline math. Requires no space just inside the dollars so "$5 and $10" stays text. */
const dollarInline = new InputRule(/(?<![\\$\w])\$([^\s$](?:[^$]*[^\s$])?)\$$/, (state, match, start, end) => {
  const node = nodes.math_inline.create({ latex: match[1] });
  return state.tr.replaceWith(start, end, node);
});

/** `$$` on an empty line → display equation; `$$` mid-line → empty inline equation. */
const doubleDollar = new InputRule(/(?<![\\$])\$\$$/, (state, _match, start, end) => {
  const $start = state.doc.resolve(start);
  const para = $start.parent;
  const lineIsEmpty = para.isTextblock && start === $start.start() && end === $start.end() - 0 && para.textContent === '$';
  if (lineIsEmpty && para.type === nodes.paragraph) {
    const node = nodes.math_display.create({ latex: '' });
    pendingFocus = { node };
    return state.tr.replaceWith($start.before(), $start.after(), node);
  }
  const node = nodes.math_inline.create({ latex: '' });
  pendingFocus = { node };
  return state.tr.replaceWith(start, end, node);
});

/** `\frac `, `\alpha `, `\int ` … typed in text start an equation with that template. */
const backslashCommand = new InputRule(/(?<![\\\w])\\([a-zA-Z]{2,})\s$/, (state, match, start, end) => {
  const template = templateForCommand(match[1]);
  if (!template) return null;
  const node = nodes.math_inline.create({ latex: '' });
  pendingFocus = { node, insert: template.replace(/#0/g, '#?') };
  return state.tr.replaceWith(start, end, node);
});

/** `\(` → empty inline equation, `\[` on an empty line → display equation. */
const latexDelims = new InputRule(/(?<!\\)\\([([])$/, (state, match, start, end) => {
  const display = match[1] === '[';
  const $start = state.doc.resolve(start);
  if (display && $start.parent.textContent === '\\' && $start.parent.type === nodes.paragraph) {
    const node = nodes.math_display.create({ latex: '' });
    pendingFocus = { node };
    return state.tr.replaceWith($start.before(), $start.after(), node);
  }
  const node = nodes.math_inline.create({ latex: '' });
  pendingFocus = { node };
  return state.tr.replaceWith(start, end, node);
});

function buildInputRules() {
  return inputRules({
    rules: [
      ...smartQuotes,
      emDash,
      ellipsis,
      doubleDollar,
      dollarInline,
      backslashCommand,
      latexDelims,
      textblockTypeInputRule(/^(#{1,4})\s$/, nodes.heading, (m) => ({ level: m[1].length })),
      wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
      wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        nodes.ordered_list,
        (m) => ({ order: +m[1] }),
        (m, node) => node.childCount + node.attrs.order === +m[1],
      ),
      textblockTypeInputRule(/^```$/, nodes.code_block),
    ],
  });
}

// ---- Arrow / backspace navigation into math ---------------------------------

type Dir = 'left' | 'right' | 'up' | 'down';

function enterMath(dir: Dir) {
  return (state: EditorState, _dispatch: unknown, view?: EditorView) => {
    if (!view) return false;
    const sel = state.selection;
    if (!(sel instanceof TextSelection) || !sel.empty) return false;
    const $pos = sel.$from;

    // Inline math directly next to the cursor.
    if (dir === 'right' && $pos.nodeAfter?.type === nodes.math_inline) {
      mathViewAt(view, $pos.pos)?.focus('start');
      return true;
    }
    if (dir === 'left' && $pos.nodeBefore?.type === nodes.math_inline) {
      mathViewAt(view, $pos.pos - $pos.nodeBefore.nodeSize)?.focus('end');
      return true;
    }

    // Display math in the neighbouring block.
    const forward = dir === 'right' || dir === 'down';
    const atEdge =
      dir === 'up' || dir === 'down'
        ? view.endOfTextblock(dir)
        : forward
          ? $pos.parentOffset === $pos.parent.content.size
          : $pos.parentOffset === 0;
    if (!atEdge || $pos.depth < 1) return false;
    const blockPos = forward ? $pos.after() : $pos.before();
    const $b = state.doc.resolve(blockPos);
    const neighbour = forward ? $b.nodeAfter : $b.nodeBefore;
    if (neighbour?.type === nodes.math_display) {
      const pos = forward ? blockPos : blockPos - neighbour.nodeSize;
      mathViewAt(view, pos)?.focus(forward ? 'start' : 'end');
      return true;
    }
    return false;
  };
}

/** Backspace right after an equation steps into it instead of deleting it wholesale. */
function backspaceIntoMath(state: EditorState, _d: unknown, view?: EditorView) {
  if (!view) return false;
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const before = sel.$from.nodeBefore;
  if (before?.type === nodes.math_inline) {
    mathViewAt(view, sel.from - before.nodeSize)?.focus('end');
    return true;
  }
  return false;
}
function deleteIntoMath(state: EditorState, _d: unknown, view?: EditorView) {
  if (!view) return false;
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  if (sel.$from.nodeAfter?.type === nodes.math_inline) {
    mathViewAt(view, sel.from)?.focus('start');
    return true;
  }
  return false;
}

/** Keep an empty paragraph at the end so there is always somewhere to type after an equation. */
const trailingParagraph = new Plugin({
  key: new PluginKey('trailing-paragraph'),
  appendTransaction(_trs, _old, state) {
    const last = state.doc.lastChild;
    if (last && last.type !== nodes.paragraph && last.type !== nodes.heading) {
      return state.tr.insert(state.doc.content.size, nodes.paragraph.create()).setMeta('addToHistory', false);
    }
    return null;
  },
});

/** Pasting plain text containing `$..$`, `\(..\)`, `$$..$$` creates real equations. */
const mathPaste = new Plugin({
  key: new PluginKey('math-paste'),
  props: {
    handlePaste(view, event) {
      const data = event.clipboardData;
      if (!data) return false;
      const html = data.getData('text/html');
      const text = data.getData('text/plain');
      if (html || !text || !hasMathDelimiters(text)) return false;
      if (view.state.selection.$from.parent.type.spec.code) return false;
      view.dispatch(view.state.tr.replaceSelection(sliceFromText(text)).scrollIntoView());
      return true;
    },
  },
});

export function buildPlugins() {
  return [
    focusPlugin,
    buildInputRules(),
    keymap({
      'Mod-z': undo,
      'Shift-Mod-z': redo,
      'Mod-y': redo,
      ArrowLeft: enterMath('left'),
      ArrowRight: enterMath('right'),
      ArrowUp: enterMath('up'),
      ArrowDown: enterMath('down'),
      Backspace: backspaceIntoMath,
      Delete: deleteIntoMath,
      Enter: splitListItem(nodes.list_item),
      Tab: sinkListItem(nodes.list_item),
      'Shift-Tab': liftListItem(nodes.list_item),
      'Shift-Enter': chainCommands(exitCode, (state, dispatch) => {
        if (dispatch) dispatch(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
        return true;
      }),
    }),
    keymap(baseKeymap),
    dropCursor({ color: 'var(--accent)' }),
    gapCursor(),
    history(),
    trailingParagraph,
    mathPaste,
  ];
}
