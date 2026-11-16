import { Schema, type NodeSpec, type MarkSpec, type DOMOutputSpec } from 'prosemirror-model';
import { addListNodes } from 'prosemirror-schema-list';

export type Align = 'left' | 'center' | 'right' | 'justify';

const alignAttr = { align: { default: 'left' as Align } };
const alignStyle = (align: Align) => (align && align !== 'left' ? `text-align: ${align}` : null);
const readAlign = (dom: HTMLElement): Align => (dom.style.textAlign as Align) || 'left';

/** Theorem-like environments, numbered per kind (except proof/remark). */
export const ENV_KINDS = {
  theorem: { label: 'Theorem', numbered: true },
  lemma: { label: 'Lemma', numbered: true },
  corollary: { label: 'Corollary', numbered: true },
  proposition: { label: 'Proposition', numbered: true },
  definition: { label: 'Definition', numbered: true },
  example: { label: 'Example', numbered: true },
  remark: { label: 'Remark', numbered: false },
  proof: { label: 'Proof', numbered: false },
} as const;
export type EnvKind = keyof typeof ENV_KINDS;

/** Pull LaTeX out of pasted KaTeX / MathJax / MathML (e.g. copied from a web page or chatbot). */
function latexFromForeign(dom: HTMLElement): string | null {
  const ann = dom.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="TeX"]');
  let tex = ann?.textContent ?? dom.getAttribute('alttext') ?? dom.getAttribute('data-tex');
  if (!tex) return null;
  tex = tex.trim();
  const ds = tex.match(/^\{\\displaystyle\s*([\s\S]*)\}$/);
  return ds ? ds[1].trim() : tex;
}
const foreignRule = (tag: string, priority = 60) => ({
  tag,
  priority,
  getAttrs: (dom: HTMLElement) => {
    const latex = latexFromForeign(dom);
    return latex ? { latex } : false;
  },
});

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: alignAttr,
    parseDOM: [{ tag: 'p', getAttrs: (dom) => ({ align: readAlign(dom as HTMLElement) }) }],
    toDOM: (node): DOMOutputSpec => {
      const style = alignStyle(node.attrs.align);
      return ['p', style ? { style } : {}, 0];
    },
  },

  heading: {
    attrs: { level: { default: 1 }, ...alignAttr },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: [1, 2, 3, 4].map((level) => ({
      tag: `h${level}`,
      getAttrs: (dom: HTMLElement) => ({ level, align: readAlign(dom) }),
    })),
    toDOM: (node): DOMOutputSpec => {
      const style = alignStyle(node.attrs.align);
      return ['h' + node.attrs.level, style ? { style } : {}, 0];
    },
  },

  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },

  /** Theorem / lemma / definition / proof boxes. */
  math_env: {
    attrs: { kind: { default: 'theorem' as EnvKind }, title: { default: '' } },
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [
      {
        tag: 'section[data-env]',
        getAttrs: (dom) => ({
          kind: (dom as HTMLElement).dataset.env,
          title: (dom as HTMLElement).dataset.title || '',
        }),
      },
    ],
    toDOM: (node): DOMOutputSpec => [
      'section',
      {
        class: `math-env env-${node.attrs.kind}`,
        'data-env': node.attrs.kind,
        'data-title': node.attrs.title,
        'data-label': ENV_KINDS[node.attrs.kind as EnvKind]?.label ?? 'Theorem',
      },
      0,
    ],
  },

  code_block: {
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM: () => ['pre', ['code', 0]],
  },

  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },

  /** Inline math, stored as LaTeX. Rendered/edited by a MathLive node view. */
  math_inline: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,
    attrs: { latex: { default: '' } },
    leafText: (node) => `$${node.attrs.latex}$`,
    parseDOM: [
      {
        tag: 'span[data-latex]',
        getAttrs: (dom) => ({ latex: (dom as HTMLElement).dataset.latex ?? '' }),
      },
      foreignRule('span.katex'),
      foreignRule('mjx-container'),
      foreignRule('math'),
    ],
    toDOM: (node): DOMOutputSpec => [
      'span',
      { class: 'math-inline', 'data-latex': node.attrs.latex },
      `$${node.attrs.latex}$`,
    ],
  },

  /** Display (block) math, optionally numbered like \begin{equation}. */
  math_display: {
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    attrs: { latex: { default: '' }, numbered: { default: false } },
    leafText: (node) => `$$${node.attrs.latex}$$`,
    parseDOM: [
      {
        tag: 'div[data-latex]',
        getAttrs: (dom) => ({
          latex: (dom as HTMLElement).dataset.latex ?? '',
          numbered: (dom as HTMLElement).dataset.numbered === 'true',
        }),
      },
      foreignRule('span.katex-display', 70),
      foreignRule('mjx-container[display="true"]', 70),
      foreignRule('math[display="block"]', 70),
    ],
    toDOM: (node): DOMOutputSpec => [
      'div',
      { class: 'math-display', 'data-latex': node.attrs.latex, 'data-numbered': String(node.attrs.numbered) },
      `$$${node.attrs.latex}$$`,
    ],
  },

  text: { group: 'inline' },

  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },
};

const marks: Record<string, MarkSpec> = {
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null },
      { style: 'font-weight=400', clearMark: (m) => m.type.name === 'strong' },
      { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[5-9]\d{2,})$/.test(v as string) && null },
    ],
    toDOM: () => ['strong', 0],
  },
  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
    toDOM: () => ['s', 0],
  },
  superscript: {
    excludes: 'subscript',
    parseDOM: [{ tag: 'sup' }],
    toDOM: () => ['sup', 0],
  },
  subscript: {
    excludes: 'superscript',
    parseDOM: [{ tag: 'sub' }],
    toDOM: () => ['sub', 0],
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
  highlight: {
    attrs: { color: { default: '#fff176' } },
    parseDOM: [
      {
        tag: 'mark',
        getAttrs: (dom) => ({ color: (dom as HTMLElement).style.backgroundColor || '#fff176' }),
      },
    ],
    toDOM: (mark) => ['mark', { style: `background-color: ${mark.attrs.color}` }, 0],
  },
  text_color: {
    attrs: { color: { default: '#000000' } },
    parseDOM: [
      {
        tag: 'span[style*="color"]',
        getAttrs: (dom) => {
          const color = (dom as HTMLElement).style.color;
          return color ? { color } : false;
        },
      },
    ],
    toDOM: (mark) => ['span', { style: `color: ${mark.attrs.color}` }, 0],
  },
  link: {
    attrs: { href: {} },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href') }) }],
    toDOM: (mark) => ['a', { href: mark.attrs.href, rel: 'noopener noreferrer' }, 0],
  },
};

/** Numbering of an ordered list: 1. 2. 3. or a. b. c. */
export type ListStyle = 'decimal' | 'lower-alpha';

const base = new Schema({ nodes, marks });
const withLists = addListNodes(base.spec.nodes, 'paragraph block*', 'block');

export const schema = new Schema({
  nodes: withLists.update('ordered_list', {
    ...withLists.get('ordered_list')!,
    attrs: { order: { default: 1 }, listStyle: { default: 'decimal' as ListStyle } },
    parseDOM: [
      {
        tag: 'ol',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const type = el.getAttribute('type') ?? '';
          const css = el.style.listStyleType;
          const alpha = type === 'a' || css === 'lower-alpha' || css === 'lower-latin';
          return {
            order: el.hasAttribute('start') ? Number(el.getAttribute('start')) || 1 : 1,
            listStyle: (alpha ? 'lower-alpha' : 'decimal') as ListStyle,
          };
        },
      },
    ],
    toDOM: (node): DOMOutputSpec => {
      const attrs: Record<string, string> = {};
      if (node.attrs.order !== 1) attrs.start = String(node.attrs.order);
      if (node.attrs.listStyle === 'lower-alpha') attrs.type = 'a';
      return ['ol', attrs, 0];
    },
  }),
  marks: base.spec.marks,
});
