import { DEFAULT_NOTATION, setNotation, type NotationPrefs } from '../math/notation';

/** User preferences, stored per device in localStorage. */
export interface Settings {
  // Document
  font: string;
  fontSize: number;
  lineSpacing: number;
  /** How numbered equations are labelled: (1) or [1]. */
  eqNumberStyle: 'paren' | 'bracket';
  spellcheck: boolean;
  theme: 'system' | 'light' | 'dark';
  // Math notation (see math/notation.ts)
  notation: NotationPrefs;
  // Math typing behaviour
  /** MathLive letter shapes: TeX (italic x, upright Γ), ISO, French, or all upright. */
  letterShape: 'tex' | 'iso' | 'french' | 'upright';
  smartFence: boolean;
  smartSuperscript: boolean;
}

export const FONT_CHOICES: { value: string; label: string; css: string }[] = [
  { value: 'Cambria', label: 'Cambria', css: "Cambria, 'Cambria Math', Georgia, serif" },
  { value: 'Times New Roman', label: 'Times New Roman', css: "'Times New Roman', Times, serif" },
  { value: 'Georgia', label: 'Georgia', css: 'Georgia, serif' },
  { value: 'Garamond', label: 'Garamond', css: "Garamond, 'EB Garamond', 'Times New Roman', serif" },
  { value: 'Palatino Linotype', label: 'Palatino', css: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
  { value: 'Calibri', label: 'Calibri', css: 'Calibri, Carlito, Arial, sans-serif' },
  { value: 'Arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { value: 'Segoe UI', label: 'Segoe UI', css: "'Segoe UI', system-ui, sans-serif" },
];

export const DEFAULT_SETTINGS: Settings = {
  font: 'Cambria',
  fontSize: 12,
  lineSpacing: 1.55,
  eqNumberStyle: 'paren',
  spellcheck: true,
  theme: 'system',
  notation: { ...DEFAULT_NOTATION },
  letterShape: 'tex',
  smartFence: true,
  smartSuperscript: true,
};

const KEY = 'mathmirror:settings';
const LEGACY_THEME_KEY = 'mathmirror:theme';

let current: Settings = load();
setNotation(current.notation);
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  const base: Settings = { ...DEFAULT_SETTINGS, notation: { ...DEFAULT_NOTATION } };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<Settings>;
      return { ...base, ...data, notation: { ...base.notation, ...(data.notation ?? {}) } };
    }
    // Carry over the theme chosen with the old dark-mode toggle.
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'light' || legacy === 'dark') base.theme = legacy;
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return base;
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch, notation: { ...current.notation, ...(patch.notation ?? {}) } };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  setNotation(current.notation);
  listeners.forEach((fn) => fn(current));
}

export function resetSettings() {
  updateSettings({ ...DEFAULT_SETTINGS, notation: { ...DEFAULT_NOTATION } });
}

export function onSettingsChanged(fn: (s: Settings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function fontCss(font: string): string {
  return FONT_CHOICES.find((f) => f.value === font)?.css ?? `'${font}', serif`;
}

/** Options the exporters need so the output matches what's on screen. */
export function exportOptions() {
  return { font: current.font, fontSize: current.fontSize, lineSpacing: current.lineSpacing, eqNumberStyle: current.eqNumberStyle };
}
export type ExportOptions = ReturnType<typeof exportOptions>;
