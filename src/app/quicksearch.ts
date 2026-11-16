import { h } from './dom';
import { renderLatex } from './dialogs';

/**
 * Quick search: Ctrl+Space opens a bar at the bottom of the window that
 * searches math symbols/templates, commands, styles, macros and files.
 * Enter runs the highlighted result. Prefixes narrow the search:
 *   m:  math symbols & templates     c:  commands & styles
 *   k:  macros & snippets            f:  recent files (desktop)
 *   \…  or  =…  insert raw LaTeX
 */

export type QSKind = 'math' | 'command' | 'macro' | 'file' | 'latex';

export interface QSItem {
  id: string;
  kind: QSKind;
  title: string;
  subtitle?: string;
  keywords?: string;
  latex?: string;
  shortcut?: string;
  active?: boolean;
  run: () => void;
}

export interface QSProvider {
  /** All candidate items (filtering happens here). */
  items: () => QSItem[];
  /** Extra items generated from the raw query (e.g. "insert this LaTeX"). */
  dynamic?: (query: string) => QSItem[];
  onOpen?: () => void;
  onClose?: (ran: boolean) => void;
}

const PREFIXES: Record<string, { kind: QSKind | null; label: string }> = {
  'm:': { kind: 'math', label: 'Math' },
  'c:': { kind: 'command', label: 'Commands' },
  'k:': { kind: 'macro', label: 'Macros' },
  'f:': { kind: 'file', label: 'Files' },
};

const KIND_LABEL: Record<QSKind, string> = {
  math: 'Math',
  command: 'Command',
  macro: 'Macro',
  file: 'File',
  latex: 'LaTeX',
};

const RECENT_KEY = 'crunchpad:qs-recent';
function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}
function pushRecent(id: string) {
  const list = [id, ...loadRecent().filter((x) => x !== id)].slice(0, 12);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** Token-based fuzzy score. Every query word must match the title or keywords. */
export function scoreItem(query: string, item: QSItem): number {
  const title = item.title.toLowerCase();
  const hay = `${title} ${(item.keywords ?? '').toLowerCase()} ${(item.latex ?? '').toLowerCase()}`;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  let total = 0;
  for (const t of tokens) {
    let s = 0;
    if (title === t) s = 12;
    else if (title.startsWith(t)) s = 9;
    else if (new RegExp(`(^|[\\s(\\\\/-])${escapeRe(t)}`).test(title)) s = 7;
    else if (title.includes(t)) s = 5;
    else if (new RegExp(`(^|[\\s\\\\{])${escapeRe(t)}`).test(hay)) s = 4;
    else if (hay.includes(t)) s = 2;
    else if (t.length > 2 && isSubsequence(t, title)) s = 1;
    if (!s) return 0;
    total += s;
  }
  // Shorter titles win ties ("pi" before "pmatrix").
  return total + 1 / (1 + title.length / 10);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function isSubsequence(needle: string, hay: string) {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

export class QuickSearch {
  private root: HTMLElement;
  private bar: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private chips: HTMLElement;
  private results: QSItem[] = [];
  private index = 0;
  private openState = false;
  private ran = false;
  private previewCache = new Map<string, string>();

  constructor(
    mount: HTMLElement,
    private provider: QSProvider,
  ) {
    this.input = h('input.qs-input', {
      type: 'text',
      placeholder: 'Search symbols, functions, commands, styles, macros…   (m: math · c: commands · k: macros · \\ LaTeX)',
      spellcheck: false,
      autocomplete: 'off',
      'aria-label': 'Quick search',
      role: 'combobox',
      'aria-controls': 'qs-results',
      'aria-expanded': 'true',
    });
    this.list = h('div.qs-results', { id: 'qs-results', role: 'listbox' });
    this.chips = h(
      'div.qs-chips',
      {},
      Object.entries(PREFIXES).map(([p, { label }]) =>
        h('button.qs-chip', { onmousedown: (e: Event) => { e.preventDefault(); this.setPrefix(p); } }, `${p} ${label}`),
      ),
    );
    this.bar = h(
      'div.qs-bar',
      {},
      h('span.qs-icon', { 'aria-hidden': 'true' }, '⌕'),
      this.input,
      this.chips,
      h('kbd.qs-esc', { title: 'Close' }, 'Esc'),
    );
    this.root = h('div.qs', { hidden: true }, this.list, this.bar);
    mount.appendChild(this.root);

    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => {
      // Clicking elsewhere closes the bar.
      setTimeout(() => {
        if (this.openState && !this.root.contains(document.activeElement)) this.close();
      }, 120);
    });
  }

  get isOpen() {
    return this.openState;
  }

  open(initial = '') {
    if (this.openState) {
      this.input.select();
      return;
    }
    this.openState = true;
    this.ran = false;
    this.provider.onOpen?.();
    this.root.hidden = false;
    this.input.value = initial;
    this.refresh();
    this.input.focus();
    this.input.select();
  }

  toggle() {
    if (this.openState) this.close();
    else this.open();
  }

  close() {
    if (!this.openState) return;
    this.openState = false;
    // Blur before hiding: MathLive aborts a focus request if the active element
    // changes during its 60ms focus delay, which hiding a focused input causes.
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.root.hidden = true;
    this.provider.onClose?.(this.ran);
  }

  private setPrefix(p: string) {
    const raw = this.input.value.replace(/^[a-z]:\s*/, '');
    this.input.value = p + ' ' + raw;
    this.input.focus();
    this.refresh();
  }

  private parse(): { kind: QSKind | null; query: string; raw: string } {
    const raw = this.input.value;
    const m = raw.match(/^([a-z]:)\s*(.*)$/i);
    if (m && PREFIXES[m[1].toLowerCase()]) return { kind: PREFIXES[m[1].toLowerCase()].kind, query: m[2], raw };
    return { kind: null, query: raw, raw };
  }

  private refresh() {
    const { kind, query, raw } = this.parse();
    const all = this.provider.items().filter((i) => !kind || i.kind === kind);
    let ranked: QSItem[];
    if (!query.trim()) {
      const recent = loadRecent();
      const byId = new Map(all.map((i) => [i.id, i]));
      const recents = recent.map((id) => byId.get(id)).filter((x): x is QSItem => !!x);
      const rest = all.filter((i) => !recent.includes(i.id));
      ranked = [...recents, ...rest].slice(0, 60);
    } else {
      ranked = all
        .map((item) => ({ item, s: scoreItem(query, item) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 60)
        .map((x) => x.item);
    }
    const dyn = kind && kind !== 'math' ? [] : (this.provider.dynamic?.(raw) ?? []);
    this.results = [...dyn, ...ranked];
    this.index = 0;
    this.render();
  }

  private preview(latex: string) {
    let html = this.previewCache.get(latex);
    if (html == null) {
      html = renderLatex(latex);
      this.previewCache.set(latex, html);
    }
    return html;
  }

  private render() {
    this.list.replaceChildren();
    if (!this.results.length) {
      this.list.append(h('div.qs-empty', {}, 'No matches. Try a symbol name ("theta"), a template ("integral"), or a command ("export").'));
      return;
    }
    this.results.forEach((item, i) => {
      const row = h(
        'div.qs-row',
        {
          role: 'option',
          'aria-selected': String(i === this.index),
          class: i === this.index ? 'qs-row selected' : 'qs-row',
          onmousedown: (e: Event) => {
            e.preventDefault();
            this.index = i;
            this.runSelected();
          },
          onmousemove: () => {
            if (this.index !== i) {
              this.index = i;
              this.updateSelection();
            }
          },
        },
        h('span', { class: `qs-kind kind-${item.kind}` }, KIND_LABEL[item.kind]),
        h('span.qs-title', {}, item.title, item.subtitle ? h('span.qs-sub', {}, item.subtitle) : null),
        item.latex ? h('span.qs-preview', { html: this.preview(item.latex) }) : h('span.qs-preview'),
        item.shortcut ? h('kbd.qs-shortcut', {}, item.shortcut) : null,
      );
      this.list.append(row);
    });
  }

  private updateSelection() {
    [...this.list.children].forEach((el, i) => {
      el.classList.toggle('selected', i === this.index);
      el.setAttribute('aria-selected', String(i === this.index));
    });
    (this.list.children[this.index] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }

  private runSelected() {
    const item = this.results[this.index];
    if (!item) return;
    this.ran = true;
    if (item.kind !== 'latex') pushRecent(item.id);
    this.close();
    item.run();
  }

  private onKey(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.index = Math.min(this.results.length - 1, this.index + 1);
        this.updateSelection();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.index = Math.max(0, this.index - 1);
        this.updateSelection();
        break;
      case 'PageDown':
        e.preventDefault();
        this.index = Math.min(this.results.length - 1, this.index + 8);
        this.updateSelection();
        break;
      case 'PageUp':
        e.preventDefault();
        this.index = Math.max(0, this.index - 8);
        this.updateSelection();
        break;
      case 'Enter':
        e.preventDefault();
        this.runSelected();
        break;
      case 'Escape':
        e.preventDefault();
        this.close();
        break;
      case 'Tab': {
        // Tab cycles through the category filters.
        e.preventDefault();
        const keys = ['', ...Object.keys(PREFIXES)];
        const cur = this.parse().kind;
        const curKey = Object.entries(PREFIXES).find(([, v]) => v.kind === cur)?.[0] ?? '';
        const next = keys[(keys.indexOf(curKey) + (e.shiftKey ? keys.length - 1 : 1)) % keys.length];
        const q = this.parse().query;
        this.input.value = next ? `${next} ${q}` : q;
        this.refresh();
        break;
      }
    }
  }
}
