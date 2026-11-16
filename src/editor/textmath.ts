import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { schema } from './schema';

const { nodes } = schema;

/** Does this plain text contain anything that looks like delimited LaTeX? */
export function hasMathDelimiters(text: string): boolean {
  return /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(^|[^\\$])\$[^\s$][^$\n]*?(?<!\s)\$/.test(text);
}

const INLINE_RE = /\\\(([\s\S]+?)\\\)|(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g;

function inlineNodes(text: string): PMNode[] {
  const out: PMNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(schema.text(text.slice(last, idx)));
    out.push(nodes.math_inline.create({ latex: (m[1] ?? m[2]).trim() }));
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(schema.text(text.slice(last)));
  return out;
}

/**
 * Turn plain text with `$..$`, `$$..$$`, `\(..\)`, `\[..\]` into document blocks.
 * Lines become paragraphs; `# ` headings are recognised for Markdown files.
 */
export function blocksFromText(text: string): PMNode[] {
  const blocks: PMNode[] = [];
  const DISPLAY_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g;
  let last = 0;
  const pushText = (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) blocks.push(nodes.heading.create({ level: h[1].length }, inlineNodes(h[2])));
      else blocks.push(nodes.paragraph.create(null, inlineNodes(line)));
    }
  };
  for (const m of text.matchAll(DISPLAY_RE)) {
    const idx = m.index ?? 0;
    pushText(text.slice(last, idx));
    blocks.push(nodes.math_display.create({ latex: (m[1] ?? m[2]).trim() }));
    last = idx + m[0].length;
  }
  pushText(text.slice(last));
  if (!blocks.length) blocks.push(nodes.paragraph.create());
  return blocks;
}

export function docFromText(text: string): PMNode {
  return nodes.doc.create(null, blocksFromText(text));
}

/** Paste slice for text containing math. Single-line text stays inline. */
export function sliceFromText(text: string): Slice {
  if (!/\n/.test(text) && !/\$\$|\\\[/.test(text)) {
    return new Slice(Fragment.from(inlineNodes(text)), 0, 0);
  }
  const blocks = blocksFromText(text);
  const open = (n: PMNode) => (n.isTextblock ? 1 : 0);
  return new Slice(Fragment.from(blocks), open(blocks[0]), open(blocks[blocks.length - 1]));
}
