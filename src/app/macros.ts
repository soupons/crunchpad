import type { InlineShortcutDefinitions } from 'mathlive';
import { setUserShortcuts } from '../math/mathfield';

/**
 * Macros are user-defined, reusable pieces of content:
 *  - "math" macros are LaTeX snippets. If they have a trigger, typing the trigger
 *    inside any equation expands it (e.g. `pd` → \frac{\partial #?}{\partial #?}).
 *  - "snippet" macros store formatted document content (text + equations) captured
 *    from a selection, and are inserted from the quick search bar.
 */
export interface Macro {
  id: string;
  name: string;
  kind: 'math' | 'snippet';
  trigger?: string;
  latex?: string;
  /** ProseMirror Slice JSON for snippet macros. */
  slice?: unknown;
  /** Plain-text preview for snippets. */
  preview?: string;
}

const KEY = 'crunchpad:macros';
let macros: Macro[] = [];
const listeners = new Set<() => void>();

const DEFAULTS: Macro[] = [
  { id: 'd-pd', name: 'Partial derivative', kind: 'math', trigger: 'pd', latex: '\\frac{\\partial #?}{\\partial #?}' },
  { id: 'd-ddx', name: 'd/dx', kind: 'math', trigger: 'ddx', latex: '\\frac{d}{dx}' },
  { id: 'd-quad', name: 'Quadratic formula', kind: 'math', trigger: 'quadf', latex: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}' },
  { id: 'd-eps', name: 'Epsilon-delta', kind: 'math', trigger: 'epsd', latex: '\\forall\\varepsilon>0\\ \\exists\\delta>0' },
];

export function loadMacros() {
  try {
    const raw = localStorage.getItem(KEY);
    macros = raw ? (JSON.parse(raw) as Macro[]) : DEFAULTS.slice();
  } catch {
    macros = DEFAULTS.slice();
  }
  apply();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(macros));
  } catch {
    /* storage unavailable (private mode); macros last for this session */
  }
  apply();
  listeners.forEach((l) => l());
}

function apply() {
  const shortcuts: InlineShortcutDefinitions = {};
  for (const m of macros) if (m.kind === 'math' && m.trigger && m.latex) shortcuts[m.trigger] = m.latex;
  setUserShortcuts(shortcuts);
}

export const getMacros = () => macros.slice();
export function onMacrosChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function saveMacro(m: Macro) {
  const i = macros.findIndex((x) => x.id === m.id);
  if (i >= 0) macros[i] = m;
  else macros.push(m);
  persist();
}

export function deleteMacro(id: string) {
  macros = macros.filter((m) => m.id !== id);
  persist();
}

export function replaceAllMacros(list: Macro[]) {
  macros = list;
  persist();
}

export const newMacroId = () => 'm-' + Math.random().toString(36).slice(2, 10);
