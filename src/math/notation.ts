import type { InlineShortcutDefinitions } from 'mathlive';

/**
 * Math notation preferences: which LaTeX the typing shortcuts and the
 * ribbon / palette / quick-search templates produce.
 */
export interface NotationPrefs {
  /** `\arcsin x` or `\sin^{-1} x`. */
  inverseTrig: 'arc' | 'power';
  /** What `*` turns into inside an equation. */
  multiply: 'cdot' | 'times';
  /** `dx` (italic) or `\mathrm{d}x` (upright, ISO style). */
  differential: 'italic' | 'upright';
  /** `ℝ` (blackboard bold) or `𝐑` (bold) for RR, NN, ZZ, QQ, CC. */
  numberSets: 'mathbb' | 'mathbf';
  /** What `vec` turns into: arrow over the letter, or a bold letter. */
  vectors: 'arrow' | 'bold';
}

export const DEFAULT_NOTATION: NotationPrefs = {
  inverseTrig: 'arc',
  multiply: 'cdot',
  differential: 'italic',
  numberSets: 'mathbb',
  vectors: 'arrow',
};

let prefs: NotationPrefs = { ...DEFAULT_NOTATION };
const listeners = new Set<() => void>();

export function getNotation(): NotationPrefs {
  return prefs;
}

export function setNotation(next: NotationPrefs) {
  prefs = { ...next };
  listeners.forEach((fn) => fn());
}

export function onNotationChanged(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const TRIG = ['sin', 'cos', 'tan'] as const;

/** Inline shortcuts that depend on the notation preferences. */
export function notationShortcuts(): InlineShortcutDefinitions {
  const p = prefs;
  const out: InlineShortcutDefinitions = {};
  for (const f of TRIG) {
    const latex = p.inverseTrig === 'power' ? `\\${f}^{-1}` : `\\arc${f}`;
    out[`arc${f}`] = latex;
    out[`a${f}`] = latex;
  }
  out['*'] = p.multiply === 'times' ? '\\times' : '\\cdot';
  const d = p.differential === 'upright' ? '\\mathrm{d}' : 'd';
  for (const v of ['x', 'y', 't']) out[`d${v}`] = `\\,${d}${v}`;
  for (const s of ['R', 'N', 'Z', 'Q', 'C']) out[s + s] = `\\${p.numberSets}{${s}}`;
  out.vec = p.vectors === 'bold' ? '\\mathbf{#?}' : '\\vec{#?}';
  return out;
}

/** Rewrite inverse trig functions in existing LaTeX to the given style. */
export function convertInverseTrig(latex: string, style: NotationPrefs['inverseTrig']): string {
  if (style === 'power') return latex.replace(/\\arc(sin|cos|tan)(?![a-zA-Z])/g, '\\$1^{-1}');
  return latex.replace(/\\(sin|cos|tan)\^(?:\{-1\}|-1)/g, '\\arc$1');
}

/**
 * Adapt a built-in template (ribbon, palette, quick search) to the current
 * notation, e.g. `\arcsin` → `\sin^{-1}` or `\,dx` → `\,\mathrm{d}x`.
 */
export function applyNotation(latex: string): string {
  let out = convertInverseTrig(latex, prefs.inverseTrig);
  if (prefs.differential === 'upright') out = out.replace(/\\,d(?=#|[A-Za-z](?![A-Za-z]))/g, '\\,\\mathrm{d}');
  if (prefs.numberSets === 'mathbf') out = out.replace(/\\mathbb\{([RNZQC])\}/g, '\\mathbf{$1}');
  return out;
}
