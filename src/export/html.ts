import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { schema } from '../editor/schema';
import { escapeXml, latexToMathML } from './mathconv';
import { fontCss, type ExportOptions } from '../app/settings';

/**
 * Standalone HTML with MathML equations (renders natively in modern browsers,
 * and pastes into Word / Google Docs as real equations).
 */
export function exportHtml(doc: PMNode, title: string, opts: ExportOptions): string {
  const eqLabel = opts.eqNumberStyle === 'bracket' ? '"[" counter(eq) "]"' : '"(" counter(eq) ")"';
  const serializer = DOMSerializer.fromSchema(schema);
  const frag = serializer.serializeFragment(doc.content);
  const host = document.createElement('div');
  host.appendChild(frag);
  host.querySelectorAll<HTMLElement>('span.math-inline, div.math-display').forEach((el) => {
    const display = el.tagName === 'DIV';
    const latex = el.dataset.latex ?? '';
    const wrapper = document.createElement(display ? 'div' : 'span');
    wrapper.className = el.className;
    if (display && el.dataset.numbered === 'true') wrapper.dataset.numbered = 'true';
    wrapper.innerHTML = latexToMathML(latex, display).replace(
      /<\/math>$/,
      `<annotation encoding="application/x-tex">${escapeXml(latex)}</annotation></math>`,
    );
    // Keep the LaTeX as an annotation so pasting back into MathMirror restores it.
    const math = wrapper.querySelector('math');
    if (math) {
      const inner = [...math.childNodes].filter((n) => !(n instanceof Element && n.tagName === 'annotation'));
      const sem = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'semantics');
      const row = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mrow');
      inner.forEach((n) => row.appendChild(n));
      sem.appendChild(row);
      const ann = math.querySelector('annotation');
      if (ann) sem.appendChild(ann);
      math.appendChild(sem);
    }
    el.replaceWith(wrapper);
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeXml(title)}</title>
<style>
  body { font-family: ${fontCss(opts.font)}; font-size: ${opts.fontSize}pt; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: ${opts.lineSpacing}; color: #1b1b1f; }
  math { font-size: 1.08em; }
  div.math-display { text-align: center; margin: 1em 0; position: relative; }
  body { counter-reset: eq; }
  div.math-display[data-numbered="true"] { counter-increment: eq; }
  div.math-display[data-numbered="true"]::after { content: ${eqLabel}; position: absolute; right: 0; top: 50%; transform: translateY(-50%); }
  section.math-env { border-left: 3px solid #3f51b5; padding: .2em 0 .2em 1em; margin: 1em 0; }
  section.math-env::before { content: attr(data-label) "."; font-weight: bold; }
  section.env-proof { border: none; padding-left: 0; }
  section.env-proof::before { font-weight: normal; font-style: italic; }
  section.env-theorem, section.env-lemma, section.env-corollary, section.env-proposition { font-style: italic; }
  blockquote { border-left: 3px solid #bbb; margin-left: 0; padding-left: 1em; color: #555; }
  div.drawing { margin: 1em 0; }
  div.drawing svg { max-width: 100%; height: auto; }
  pre { background: #f3f3f3; padding: .75em; overflow-x: auto; }
</style>
</head>
<body>
${host.innerHTML}
</body>
</html>
`;
}
