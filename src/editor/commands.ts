import { setBlockType, toggleMark, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import type { MarkType, NodeType, Node as PMNode } from 'prosemirror-model';
import { NodeSelection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { MathfieldElement } from 'mathlive';
import { schema, type Align, type EnvKind, type ListStyle } from './schema';
import { mathViewAt } from './mathview';
import { focusMathfield, getActiveMathfield } from '../math/mathfield';
import { applyNotation } from '../math/notation';

const { nodes, marks } = schema;

// ---- State queries --------------------------------------------------------

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export function blockActive(state: EditorState, type: NodeType, attrs: Record<string, unknown> = {}): boolean {
  const { $from } = state.selection;
  const node = $from.parent;
  if (node.type !== type) return false;
  return Object.entries(attrs).every(([k, v]) => node.attrs[k] === v);
}

export function inAncestor(state: EditorState, type: NodeType): PMNode | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === type) return $from.node(d);
  return null;
}

export function currentAlign(state: EditorState): Align {
  return (state.selection.$from.parent.attrs.align as Align) ?? 'left';
}

// ---- Formatting -----------------------------------------------------------

export const toggleBold = toggleMark(marks.strong);
export const toggleItalic = toggleMark(marks.em);
export const toggleUnderline = toggleMark(marks.underline);
export const toggleStrike = toggleMark(marks.strike);
export const toggleSup = toggleMark(marks.superscript);
export const toggleSub = toggleMark(marks.subscript);
export const toggleCode = toggleMark(marks.code);

function setColorMark(type: MarkType, color: string | null): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (!dispatch) return true;
    let tr = state.tr;
    if (empty) {
      tr = color ? tr.addStoredMark(type.create({ color })) : tr.removeStoredMark(type);
    } else {
      tr = tr.removeMark(from, to, type);
      if (color) tr = tr.addMark(from, to, type.create({ color }));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}
export const setHighlight = (color: string | null) => setColorMark(marks.highlight, color);
export const setTextColor = (color: string | null) => setColorMark(marks.text_color, color);

export const clearFormatting: Command = (state, dispatch) => {
  const { from, to } = state.selection;
  if (dispatch) {
    let tr = state.tr;
    for (const m of Object.values(marks)) tr = tr.removeMark(from, to, m);
    tr.setStoredMarks([]);
    dispatch(tr);
  }
  return true;
};

export const setParagraph = setBlockType(nodes.paragraph);
export const setHeading = (level: number) => setBlockType(nodes.heading, { level });
export const setCodeBlock = setBlockType(nodes.code_block);
export const toggleBulletList: Command = (s, d) =>
  inAncestor(s, nodes.bullet_list) ? liftListItem(nodes.list_item)(s, d) : wrapInList(nodes.bullet_list)(s, d);
/** The innermost list (bulleted or ordered) around the selection, with its position. */
function nearestList(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type === nodes.bullet_list || n.type === nodes.ordered_list) return { node: n, pos: $from.before(d) };
  }
  return null;
}

/** Style of the innermost ordered list around the selection, if that's the innermost list. */
export function orderedListStyle(state: EditorState): ListStyle | null {
  const list = nearestList(state);
  return list?.node.type === nodes.ordered_list ? (list.node.attrs.listStyle as ListStyle) : null;
}

/**
 * Numbered (1. 2. 3.) or lettered (a. b. c.) list. Inside a list of the same
 * kind this removes the list; inside a different list it switches its style.
 */
export function toggleOrderedListStyle(listStyle: ListStyle): Command {
  return (state, dispatch) => {
    const list = nearestList(state);
    if (!list) return wrapInList(nodes.ordered_list, { listStyle })(state, dispatch);
    if (list.node.type === nodes.ordered_list && list.node.attrs.listStyle === listStyle) {
      return liftListItem(nodes.list_item)(state, dispatch);
    }
    const attrs = list.node.type === nodes.ordered_list ? { ...list.node.attrs, listStyle } : { order: 1, listStyle };
    if (dispatch) dispatch(state.tr.setNodeMarkup(list.pos, nodes.ordered_list, attrs));
    return true;
  };
}
export const toggleOrderedList = toggleOrderedListStyle('decimal');
export const toggleLetteredList = toggleOrderedListStyle('lower-alpha');
export const toggleBlockquote: Command = (s, d) =>
  inAncestor(s, nodes.blockquote) ? lift(s, d) : wrapIn(nodes.blockquote)(s, d);

export function setAlign(align: Align): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    let tr = state.tr;
    let applicable = false;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock && 'align' in node.attrs) {
        applicable = true;
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
      }
    });
    if (applicable && dispatch) dispatch(tr);
    return applicable;
  };
}

/** Wrap the selection in a theorem/definition/proof block, or unwrap if already inside one. */
export function toggleEnv(kind: EnvKind): Command {
  return (state, dispatch) => {
    const existing = inAncestor(state, nodes.math_env);
    if (existing) {
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === nodes.math_env) {
          const pos = $from.before(d);
          if (existing.attrs.kind !== kind) {
            if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { ...existing.attrs, kind }));
            return true;
          }
          return lift(state, dispatch);
        }
      }
    }
    return wrapIn(nodes.math_env, { kind })(state, dispatch);
  };
}

export const insertHorizontalRule: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(nodes.horizontal_rule.create()).scrollIntoView());
  return true;
};

/**
 * Insert a drawing area below the top-level block containing the cursor,
 * centred on the page, and select it so its toolbar shows.
 */
export function insertDrawing(view: EditorView) {
  const { state } = view;
  const { $from } = state.selection;
  const at = $from.depth > 0 ? $from.after(1) : state.selection.from;
  const width = 420;
  const contentWidth = view.dom.clientWidth / (parseFloat(view.dom.closest<HTMLElement>('.page')?.style.getPropertyValue('--zoom') ?? '') || 1);
  const x = Math.max(0, Math.round((contentWidth - width) / 2));
  const node = nodes.drawing.create({ width, height: 260, x, wrap: 'block', shapes: [] });
  let tr = state.tr.insert(at, node);
  // Keep a paragraph after the drawing so there's somewhere to keep typing.
  const after = at + node.nodeSize;
  if (!tr.doc.resolve(after).nodeAfter) tr = tr.insert(after, nodes.paragraph.create());
  tr = tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
}

// ---- Math -----------------------------------------------------------------

/** Focus the mathfield of the math node at `pos`. */
export function focusMathAt(view: EditorView, pos: number, where: 'start' | 'end' = 'end'): MathfieldElement | null {
  const mv = mathViewAt(view, pos);
  if (!mv) return null;
  mv.focus(where);
  return mv.mf;
}

function findNodePos(doc: PMNode, target: PMNode): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node === target) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

export interface InsertMathOptions {
  display?: boolean;
  /** Insert into this mathfield instead of creating a new node. */
  target?: MathfieldElement | null;
  /** When false, never insert into an existing mathfield. */
  intoActive?: boolean;
  /** Insert the LaTeX exactly as given (user macros); otherwise adapt it to the notation settings. */
  raw?: boolean;
}

/**
 * Insert a LaTeX snippet. If the user is typing inside a mathfield it goes there
 * (at the caret, replacing `#0` with the selection); otherwise a new math node is
 * created and focused with the first placeholder selected.
 */
export function insertMath(view: EditorView, latex: string, opts: InsertMathOptions = {}) {
  if (!opts.raw) latex = applyNotation(latex);
  const target = opts.target ?? (opts.intoActive === false ? null : getActiveMathfield());
  if (target && target.isConnected && !opts.display) {
    focusMathfield(target);
    target.insert(latex, { format: 'latex', selectionMode: 'placeholder', focus: true, scrollIntoView: true });
    return;
  }

  const { state } = view;
  const { selection } = state;
  // Use selected plain text as the template's main argument.
  const selected = selection.empty ? '' : state.doc.textBetween(selection.from, selection.to, ' ');
  let template = latex;
  if (selected && !/#0/.test(template)) template = selected + template;
  template = template.replace(/#0/g, selected || '#?');
  const needsInsert = template.length > 0;

  let tr = state.tr;
  let node: PMNode;
  if (opts.display) {
    node = nodes.math_display.create({ latex: '' });
    const { $from } = selection;
    if ($from.parent.isTextblock && $from.parent.content.size === 0 && $from.depth > 0) {
      // Replace an empty paragraph with the display block.
      tr = tr.replaceWith($from.before(), $from.after(), node);
    } else {
      tr = tr.replaceSelectionWith(node);
    }
  } else {
    node = nodes.math_inline.create({ latex: '' });
    tr = tr.replaceSelectionWith(node, false);
  }
  view.focus();
  view.dispatch(tr.scrollIntoView());

  const pos = findNodePos(view.state.doc, node);
  if (pos == null) return;
  const mv = mathViewAt(view, pos);
  if (!mv) return;
  mv.focus('end', (mf) => {
    if (needsInsert) mf.insert(template, { format: 'latex', selectionMode: 'placeholder', focus: true });
  });
}

/** The math node the selection is on (node selection) or whose mathfield has focus. */
export function selectedMath(view: EditorView): { node: PMNode; pos: number } | null {
  const sel = view.state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name.startsWith('math_') && sel.node.type !== nodes.math_env) {
    return { node: sel.node, pos: sel.from };
  }
  const mf = getActiveMathfield();
  return mf ? mathNodeForField(view, mf) : null;
}

/** Locate the document node that owns a given mathfield. */
export function mathNodeForField(view: EditorView, mf: MathfieldElement): { node: PMNode; pos: number } | null {
  const host = mf.parentElement;
  if (!host) return null;
  let result: { node: PMNode; pos: number } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (result) return false;
    if ((node.type === nodes.math_inline || node.type === nodes.math_display) && view.nodeDOM(pos) === host) {
      result = { node, pos };
    }
    return true;
  });
  return result;
}

export function toggleEquationNumber(view: EditorView): boolean {
  const m = selectedMath(view);
  if (!m || m.node.type !== nodes.math_display) return false;
  view.dispatch(view.state.tr.setNodeMarkup(m.pos, undefined, { ...m.node.attrs, numbered: !m.node.attrs.numbered }));
  return true;
}

/** Convert inline math ⇄ display math. */
export function toggleMathDisplay(view: EditorView): boolean {
  const m = selectedMath(view);
  if (!m) return false;
  const latex = m.node.attrs.latex;
  const { state } = view;
  let tr = state.tr;
  if (m.node.type === nodes.math_inline) {
    const display = nodes.math_display.create({ latex });
    tr = tr.setSelection(NodeSelection.create(state.doc, m.pos)).replaceSelectionWith(display);
  } else {
    const para = nodes.paragraph.create(null, nodes.math_inline.create({ latex }));
    tr = tr.replaceWith(m.pos, m.pos + m.node.nodeSize, para);
    tr = tr.setSelection(TextSelection.create(tr.doc, m.pos + 1));
  }
  view.focus();
  view.dispatch(tr);
  return true;
}
