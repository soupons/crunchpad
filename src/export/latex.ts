import type { Mark, Node as PMNode } from 'prosemirror-model';
import { cleanLatex } from './mathconv';

const TEXT_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '%': '\\%',
  _: '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
};
const escTex = (s: string) => s.replace(/[\\{}$&#%_^~]/g, (c) => TEXT_ESCAPES[c]);

function wrapMarks(text: string, marks: readonly Mark[]): string {
  let out = text;
  for (const m of marks) {
    switch (m.type.name) {
      case 'strong': out = `\\textbf{${out}}`; break;
      case 'em': out = `\\emph{${out}}`; break;
      case 'underline': out = `\\underline{${out}}`; break;
      case 'strike': out = `\\sout{${out}}`; break;
      case 'superscript': out = `\\textsuperscript{${out}}`; break;
      case 'subscript': out = `\\textsubscript{${out}}`; break;
      case 'code': out = `\\texttt{${out}}`; break;
      case 'highlight': out = `\\hl{${out}}`; break;
      case 'link': out = `\\href{${m.attrs.href}}{${out}}`; break;
      case 'text_color': {
        const hex = String(m.attrs.color).replace('#', '');
        if (/^[0-9a-f]{6}$/i.test(hex)) out = `\\textcolor[HTML]{${hex.toUpperCase()}}{${out}}`;
        break;
      }
    }
  }
  return out;
}

function inline(node: PMNode): string {
  let out = '';
  node.forEach((c) => {
    if (c.isText) out += wrapMarks(escTex(c.text ?? ''), c.marks);
    else if (c.type.name === 'math_inline') out += `$${cleanLatex(c.attrs.latex)}$`;
    else if (c.type.name === 'hard_break') out += '\\\\\n';
  });
  return out;
}

function block(node: PMNode, out: string[]) {
  switch (node.type.name) {
    case 'paragraph': {
      const body = inline(node);
      const align = node.attrs.align;
      if (align === 'center') out.push(`\\begin{center}\n${body}\n\\end{center}`);
      else if (align === 'right') out.push(`\\begin{flushright}\n${body}\n\\end{flushright}`);
      else out.push(body);
      break;
    }
    case 'heading': {
      const cmd = ['section', 'subsection', 'subsubsection', 'paragraph'][node.attrs.level - 1] ?? 'paragraph';
      out.push(`\\${cmd}{${inline(node)}}`);
      break;
    }
    case 'math_display':
      out.push(
        node.attrs.numbered
          ? `\\begin{equation}\n  ${cleanLatex(node.attrs.latex)}\n\\end{equation}`
          : `\\[\n  ${cleanLatex(node.attrs.latex)}\n\\]`,
      );
      break;
    case 'blockquote': {
      const inner: string[] = [];
      node.forEach((c) => block(c, inner));
      out.push(`\\begin{quote}\n${inner.join('\n\n')}\n\\end{quote}`);
      break;
    }
    case 'math_env': {
      const inner: string[] = [];
      node.forEach((c) => block(c, inner));
      const title = node.attrs.title ? `[${escTex(node.attrs.title)}]` : '';
      out.push(`\\begin{${node.attrs.kind}}${title}\n${inner.join('\n\n')}\n\\end{${node.attrs.kind}}`);
      break;
    }
    case 'bullet_list':
    case 'ordered_list': {
      const env = node.type.name === 'bullet_list' ? 'itemize' : 'enumerate';
      const items: string[] = [];
      node.forEach((item) => {
        const inner: string[] = [];
        item.forEach((c) => block(c, inner));
        items.push(`  \\item ${inner.join('\n\n')}`);
      });
      out.push(`\\begin{${env}}\n${items.join('\n')}\n\\end{${env}}`);
      break;
    }
    case 'code_block':
      out.push(`\\begin{verbatim}\n${node.textContent}\n\\end{verbatim}`);
      break;
    case 'horizontal_rule':
      out.push('\\noindent\\rule{\\linewidth}{0.4pt}');
      break;
    default:
      if (node.isTextblock) out.push(inline(node));
  }
}

export function exportLatex(doc: PMNode, title: string): string {
  const body: string[] = [];
  doc.forEach((n) => {
    if (n.type.name === 'paragraph' && n.content.size === 0) return;
    block(n, body);
  });
  return `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath, amssymb, amsthm, mathtools}
\\usepackage{xcolor, soul}
\\usepackage[normalem]{ulem}
\\usepackage[margin=1in]{geometry}
\\usepackage{hyperref}

\\theoremstyle{plain}
\\newtheorem{theorem}{Theorem}
\\newtheorem{lemma}{Lemma}
\\newtheorem{corollary}{Corollary}
\\newtheorem{proposition}{Proposition}
\\theoremstyle{definition}
\\newtheorem{definition}{Definition}
\\newtheorem{example}{Example}
\\theoremstyle{remark}
\\newtheorem*{remark}{Remark}

\\title{${escTex(title)}}
\\date{}

\\begin{document}

${body.join('\n\n')}

\\end{document}
`;
}
