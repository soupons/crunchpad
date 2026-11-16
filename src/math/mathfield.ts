import { MathfieldElement, type InlineShortcutDefinitions } from 'mathlive';

/**
 * Global MathLive setup plus tracking of which mathfield the user is typing in,
 * so the ribbon and quick search can insert into it.
 */

let configured = false;
export function configureMathLive() {
  if (configured) return;
  configured = true;
  MathfieldElement.fontsDirectory = new URL('mathlive/fonts', document.baseURI).href;
  MathfieldElement.soundsDirectory = null;
  MathfieldElement.plonkSound = null;
  MathfieldElement.keypressSound = null;
}

/** Every live mathfield in the document, so macro changes can be pushed to all of them. */
const live = new Set<MathfieldElement>();
let active: MathfieldElement | null = null;
/** Last mathfield that had focus; survives a click into the quick search box. */
let lastFocused: MathfieldElement | null = null;

let extraShortcuts: InlineShortcutDefinitions = {};
let defaultShortcuts: InlineShortcutDefinitions | null = null;

/** Extra ease-of-use shortcuts on top of MathLive's defaults (alpha, sqrt, ->, <=, ...). */
const BUILTIN_EXTRAS: InlineShortcutDefinitions = {
  RR: '\\mathbb{R}',
  NN: '\\mathbb{N}',
  ZZ: '\\mathbb{Z}',
  QQ: '\\mathbb{Q}',
  CC: '\\mathbb{C}',
  '=>': '\\Rightarrow',
  '<=>': '\\Leftrightarrow',
  ':=': '\\coloneqq',
  '~~': '\\approx',
  '...': '\\ldots',
  inf: '\\infty',
  deg: '^{\\circ}',
  dx: '\\,dx',
  dy: '\\,dy',
  dt: '\\,dt',
  vec: '\\vec{#?}',
  hat: '\\hat{#?}',
  bar: '\\overline{#?}',
  abs: '\\left|#?\\right|',
  norm: '\\left\\|#?\\right\\|',
  lim: '\\lim_{#?\\to#?}',
  frac: '\\frac{#?}{#?}',
  binom: '\\binom{#?}{#?}',
  mat: '\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}',
  cases: '\\begin{cases}#?&#?\\\\#?&#?\\end{cases}',
};

function shortcutsFor(mf: MathfieldElement): InlineShortcutDefinitions {
  if (!defaultShortcuts) defaultShortcuts = { ...mf.inlineShortcuts };
  return { ...defaultShortcuts, ...BUILTIN_EXTRAS, ...extraShortcuts };
}

/** Mathfields whose shortcut list can be set (MathLive requires the element to be mounted). */
const mounted = new WeakSet<MathfieldElement>();

export function setUserShortcuts(shortcuts: InlineShortcutDefinitions) {
  extraShortcuts = shortcuts;
  for (const mf of live) if (mounted.has(mf)) mf.inlineShortcuts = shortcutsFor(mf);
}

export function createMathfield(display: boolean): MathfieldElement {
  configureMathLive();
  const mf = new MathfieldElement();
  mf.smartFence = true;
  mf.smartSuperscript = true;
  mf.mathVirtualKeyboardPolicy = 'auto';
  mf.classList.add(display ? 'mf-display' : 'mf-inline');
  mf.addEventListener('mount', () => {
    mounted.add(mf);
    mf.inlineShortcuts = shortcutsFor(mf);
  });
  mf.addEventListener('focusin', () => {
    active = mf;
    lastFocused = mf;
  });
  mf.addEventListener('focusout', () => {
    if (active === mf) active = null;
  });
  live.add(mf);
  return mf;
}

export function releaseMathfield(mf: MathfieldElement) {
  live.delete(mf);
  if (active === mf) active = null;
  if (lastFocused === mf) lastFocused = null;
}

/**
 * Focus a mathfield reliably. MathLive's focus() is a no-op while it still
 * believes it has focus (e.g. after focus moved to the quick search box), so
 * reset that state first.
 */
export function focusMathfield(mf: MathfieldElement) {
  if (document.activeElement !== mf) mf.blur();
  mf.focus();
}

export function getActiveMathfield(): MathfieldElement | null {
  return active && active.isConnected ? active : null;
}

export function getLastFocusedMathfield(): MathfieldElement | null {
  return lastFocused && lastFocused.isConnected ? lastFocused : null;
}

export function showVirtualKeyboard(toggle = true) {
  const kbd = window.mathVirtualKeyboard;
  if (!kbd) return;
  if (toggle && kbd.visible) kbd.hide();
  else kbd.show();
}
