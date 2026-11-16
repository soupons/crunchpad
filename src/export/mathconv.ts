import { convertLatexToMathMl } from 'mathlive';
import { mml2omml } from 'mathml2omml';

/** Commands MathLive can render but can't turn into MathML; swap in equivalents for export. */
const MATHML_SUBSTITUTIONS: [RegExp, string][] = [
  [/\\bmod\b/g, '\\mathrm{mod}'],
  [/\\coloneqq\b/g, ':='],
  [/\\iff\b/g, '\\Longleftrightarrow'],
  [/\\implies\b/g, '\\Longrightarrow'],
  [/\\overline\{/g, '\\bar{'],
  [/\\underline\{/g, '\\underset{\\_}{'],
];

const INVISIBLE_OPS = /<mo>(?:&#8289;|&#8290;|&#8291;|&#8292;|&#x206[1-4];|[⁡-⁤])<\/mo>/gi;

/** Remove MathLive's empty-slot markers (`\placeholder{}`) before exporting. */
export function cleanLatex(latex: string): string {
  return latex.replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, '').trim();
}

export function latexToMathML(latex: string, display = false): string {
  latex = cleanLatex(latex);
  let src = latex;
  for (const [re, rep] of MATHML_SUBSTITUTIONS) src = src.replace(re, rep);
  let inner = '';
  try {
    inner = convertLatexToMathMl(src);
  } catch {
    inner = '';
  }
  if (!inner) inner = `<mtext>${escapeXml(latex)}</mtext>`;
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}>${inner}</math>`;
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** LaTeX → Word OMML `<m:oMath>` element. */
export function latexToOmml(latex: string): string {
  latex = cleanLatex(latex);
  const mml = latexToMathML(latex).replace(INVISIBLE_OPS, '');
  let omml = '';
  try {
    omml = mml2omml(mml);
  } catch {
    omml = '';
  }
  if (!omml || /^<m:oMath[^>]*\/>$/.test(omml.trim())) {
    return `<m:oMath><m:r><m:t xml:space="preserve">${escapeXml(latex)}</m:t></m:r></m:oMath>`;
  }
  // mml2omml decodes entities: re-escape text, and drop stray text outside <m:t>
  // (e.g. leftover function-application characters) that Word would reject.
  return omml
    .replace(/ xmlns:(m|w)="[^"]*"/g, '')
    // OMML requires <m:rPr> before <w:rPr> inside a math run.
    .replace(/(<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)(<m:rPr>(?:(?!<\/m:rPr>)[\s\S])*<\/m:rPr>)/g, '$2$1')
    .replace(/(<m:t(?:\s[^>]*)?>)([\s\S]*?)(<\/m:t>)|>([^<]+)(?=<)/g, (_all, open, text, close, stray) =>
      stray !== undefined ? '>' : open + escapeXml(text) + close,
    );
}
