import { h, keepFocus } from './dom';
import { getCommand, runCommand, shortcutLabel } from './registry';
import { renderLatex } from './dialogs';
import { CATEGORIES, MATH_CATALOG, type MathCategory } from '../math/catalog';
import { LOGO_SVG } from './logo';

/**
 * The top banner: panels of related controls laid out left to right
 * (File · Styles · Font · Paragraph · Equation · Structures · Symbols ·
 * Environments · Export), with search/macros/help on the right.
 */

export interface RibbonDeps {
  insertLatex: (latex: string) => void;
  applyHighlight: (color: string | null) => void;
  applyTextColor: (color: string | null) => void;
}

interface ButtonSpec {
  cmd: string;
  label?: string;
  html?: string;
  cls?: string;
  title?: string;
}

const HIGHLIGHTS = ['#fff176', '#a5d6a7', '#80deea', '#f48fb1', '#ffcc80', '#ce93d8'];
const TEXT_COLORS = ['#000000', '#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00', '#757575'];

let openPopover: { el: HTMLElement; close: () => void } | null = null;

function popover(anchor: HTMLElement, content: HTMLElement, cls = '') {
  openPopover?.close();
  const el = h('div.popover', { class: `popover ${cls}`, role: 'dialog' }, content);
  keepFocus(el);
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
  el.style.top = `${r.bottom + 4}px`;
  const onDown = (e: MouseEvent) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    el.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (openPopover?.el === el) openPopover = null;
  };
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  openPopover = { el, close };
  return close;
}

export class Ribbon {
  private buttons: { el: HTMLElement; cmd: string }[] = [];
  private lastHighlight = HIGHLIGHTS[0];
  private lastTextColor = TEXT_COLORS[1];

  constructor(
    private root: HTMLElement,
    private deps: RibbonDeps,
  ) {
    keepFocus(root);
    this.build();
  }

  private btn(spec: ButtonSpec): HTMLElement {
    const c = getCommand(spec.cmd);
    const sc = c?.shortcut ? ` (${shortcutLabel(c.shortcut)})` : '';
    const el = h('button', {
      class: `rb-btn ${spec.cls ?? ''}`,
      title: (spec.title ?? c?.title ?? spec.cmd) + sc,
      'aria-label': spec.title ?? c?.title ?? spec.cmd,
      onclick: () => runCommand(spec.cmd),
    });
    if (spec.html) el.innerHTML = spec.html;
    else el.textContent = spec.label ?? c?.title ?? spec.cmd;
    this.buttons.push({ el, cmd: spec.cmd });
    return el;
  }

  private mathBtn(latex: string, title: string, cls = '', preview = latex): HTMLElement {
    return h('button', {
      class: `rb-btn rb-math ${cls}`,
      title,
      'aria-label': title,
      html: renderLatex(preview),
      onclick: () => this.deps.insertLatex(latex),
    });
  }

  private group(label: string, ...content: HTMLElement[]) {
    return h('div.rb-group', { role: 'group', 'aria-label': label }, h('div.rb-items', {}, ...content), h('div.rb-label', {}, label));
  }

  private col(...content: HTMLElement[]) {
    return h('div.rb-col', {}, ...content);
  }
  private row(...content: HTMLElement[]) {
    return h('div.rb-row', {}, ...content);
  }

  private colorSplit(kind: 'highlight' | 'text') {
    const isHl = kind === 'highlight';
    const swatch = h('span.rb-swatch');
    const setSwatch = () => (swatch.style.background = isHl ? this.lastHighlight : this.lastTextColor);
    setSwatch();
    const main = h(
      'button.rb-btn.rb-split-main',
      {
        title: isHl ? 'Highlight' : 'Text color',
        'aria-label': isHl ? 'Highlight' : 'Text color',
        onclick: () => (isHl ? this.deps.applyHighlight(this.lastHighlight) : this.deps.applyTextColor(this.lastTextColor)),
      },
      h('span', { class: isHl ? 'rb-hl-icon' : 'rb-tc-icon' }, isHl ? 'ab' : 'A'),
      swatch,
    );
    const arrow = h('button.rb-btn.rb-split-arrow', { title: 'Choose color', 'aria-label': 'Choose color' }, '▾');
    arrow.addEventListener('click', () => {
      const colors = isHl ? HIGHLIGHTS : TEXT_COLORS;
      let close = () => {};
      const grid = h(
        'div.swatch-grid',
        {},
        colors.map((c) =>
          h('button.swatch', {
            style: `background:${c}`,
            title: c,
            'aria-label': c,
            onclick: () => {
              if (isHl) this.lastHighlight = c;
              else this.lastTextColor = c;
              setSwatch();
              if (isHl) this.deps.applyHighlight(c);
              else this.deps.applyTextColor(c);
              close();
            },
          }),
        ),
        h(
          'button.swatch.none',
          {
            title: isHl ? 'No highlight' : 'Automatic',
            onclick: () => {
              if (isHl) this.deps.applyHighlight(null);
              else this.deps.applyTextColor(null);
              close();
            },
          },
          '∅',
        ),
      );
      close = popover(arrow, grid);
    });
    return h('div.rb-split', {}, main, arrow);
  }

  /** Full symbol palette with category tabs. */
  openPalette(anchor: HTMLElement, initial: MathCategory = 'Greek') {
    const tabs = h('div.pal-tabs', { role: 'tablist' });
    const grid = h('div.pal-grid');
    const show = (cat: MathCategory) => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
      grid.replaceChildren(
        ...MATH_CATALOG.filter((e) => e.category === cat).map((e) =>
          h('button.pal-item', {
            title: `${e.title}  ${e.latex.replace(/#[0?]/g, '□')}`,
            'aria-label': e.title,
            html: renderLatex(e.latex),
            onclick: () => this.deps.insertLatex(e.latex),
          }),
        ),
      );
    };
    for (const cat of CATEGORIES) {
      tabs.append(h('button.pal-tab', { 'data-cat': cat, role: 'tab', onclick: () => show(cat) }, cat));
    }
    show(initial);
    popover(anchor, h('div.palette', {}, tabs, grid, h('div.pal-hint', {}, 'Tip: Ctrl+Space and type a name, e.g. "theta" or "integral".')), 'palette-pop');
  }

  private menu(anchor: HTMLElement, items: [string, string][]) {
    let close = () => {};
    const menu = h(
      'div.menu',
      { role: 'menu' },
      items.map(([cmd, label]) =>
        h('button.menu-item', { role: 'menuitem', onclick: () => { close(); runCommand(cmd); } }, label),
      ),
    );
    close = popover(anchor, menu);
  }

  private menuBtn(label: string, title: string, items: [string, string][], cls = '') {
    const b = h('button', { class: `rb-btn rb-menu-btn ${cls}`, title, 'aria-label': title, 'aria-haspopup': 'menu' }, label, h('span.caret', {}, '▾'));
    b.addEventListener('click', () => this.menu(b, items));
    return b;
  }

  private build() {
    // [latex inserted, preview shown on the button, tooltip]
    const structures: [string, string, string][] = [
      ['\\frac{#0}{#?}', '\\frac{a}{b}', 'Fraction  (type / in an equation)'],
      ['\\sqrt{#0}', '\\sqrt{x}', 'Square root  (sqrt)'],
      ['#0^{#?}', 'x^n', 'Superscript  (^)'],
      ['#0_{#?}', 'x_i', 'Subscript  (_)'],
      ['\\int_{#?}^{#?} #0\\,d#?', '\\int_a^b', 'Definite integral  (int)'],
      ['\\sum_{#?}^{#?} #0', '\\sum', 'Sum  (sum)'],
      ['\\lim_{#?\\to #?} #0', '\\lim', 'Limit  (lim)'],
      ['\\left(#0\\right)', '(x)', 'Parentheses'],
    ];
    const symbols: [string, string][] = [
      ['\\alpha', 'alpha'], ['\\beta', 'beta'], ['\\theta', 'theta'], ['\\pi', 'pi'],
      ['\\infty', 'infinity  (oo)'], ['\\pm', 'plus-minus  (+-)'], ['\\leq', 'less or equal  (<=)'], ['\\neq', 'not equal  (!=)'],
    ];

    const morePal = h('button.rb-btn.rb-more', { title: 'All math symbols & templates', 'aria-label': 'All math symbols and templates' }, 'All ▾');
    morePal.addEventListener('click', () => this.openPalette(morePal, 'Structures'));
    const matrixBtn = this.btn({ cmd: 'math-matrix', html: renderLatex('\\begin{bmatrix}\\,\\end{bmatrix}') + '<span class="rb-mini">Matrix</span>', title: 'Insert matrix…' });

    const left = h(
      'div.rb-groups',
      {},
      this.group(
        'File',
        this.col(this.btn({ cmd: 'file-new', label: 'New' }), this.btn({ cmd: 'file-open', label: 'Open' })),
        this.col(this.btn({ cmd: 'file-save', label: 'Save' }), this.btn({ cmd: 'file-save-as', label: 'Save as' })),
        this.col(
          this.menuBtn('Export', 'Export to Word, PDF, LaTeX or HTML', [
            ['export-docx', 'Word document (.docx)'],
            ['export-pdf', 'PDF'],
            ['export-latex', 'LaTeX (.tex)'],
            ['export-html', 'Web page (.html)'],
          ]),
          this.btn({ cmd: 'macro-manage', label: 'Macros' }),
        ),
      ),
      this.group(
        'Styles',
        h(
          'div.rb-styles',
          {},
          this.btn({ cmd: 'style-normal', label: 'Normal', cls: 'style-chip s-normal' }),
          this.btn({ cmd: 'style-h1', label: 'Heading 1', cls: 'style-chip s-h1' }),
          this.btn({ cmd: 'style-h2', label: 'Heading 2', cls: 'style-chip s-h2' }),
          this.btn({ cmd: 'style-code', label: 'Code', cls: 'style-chip s-code' }),
          this.btn({ cmd: 'style-h3', label: 'Heading 3', cls: 'style-chip s-h3' }),
          this.btn({ cmd: 'style-h4', label: 'Heading 4', cls: 'style-chip s-h4' }),
        ),
      ),
      this.group(
        'Font',
        this.col(
          this.row(
            this.btn({ cmd: 'fmt-bold', html: '<b>B</b>' }),
            this.btn({ cmd: 'fmt-italic', html: '<i>I</i>' }),
            this.btn({ cmd: 'fmt-underline', html: '<u>U</u>' }),
            this.btn({ cmd: 'fmt-code', html: '<code>&lt;/&gt;</code>' }),
          ),
          this.row(
            this.colorSplit('highlight'),
            this.colorSplit('text'),
            this.btn({ cmd: 'fmt-clear', html: '<span class="rb-clear">T<small>×</small></span>' }),
          ),
        ),
      ),
      this.group(
        'Paragraph',
        this.col(
          this.row(
            this.btn({ cmd: 'list-ordered', html: '<span class="ico-list">1≡</span>' }),
            this.btn({ cmd: 'list-lettered', html: '<span class="ico-list">a≡</span>' }),
            this.btn({ cmd: 'block-quote', html: '<span class="ico-quote">❝</span>' }),
            this.btn({ cmd: 'insert-hr', html: '―' }),
          ),
          this.row(
            this.btn({ cmd: 'align-left', html: '<span class="al al-l"></span>' }),
            this.btn({ cmd: 'align-center', html: '<span class="al al-c"></span>' }),
            this.btn({ cmd: 'align-right', html: '<span class="al al-r"></span>' }),
            this.btn({ cmd: 'align-justify', html: '<span class="al al-j"></span>' }),
          ),
        ),
      ),
      this.group(
        'Equation',
        this.btn({ cmd: 'math-inline', html: `<span class="rb-big">${renderLatex('x^2')}</span><span>Inline</span>`, cls: 'rb-tall' }),
        this.btn({ cmd: 'math-display', html: `<span class="rb-big">${renderLatex('\\sum')}</span><span>Display</span>`, cls: 'rb-tall' }),
        this.col(
          this.btn({ cmd: 'math-edit-source', label: 'LaTeX' }),
          this.btn({ cmd: 'math-toggle-number', label: '(1) Number' }),
        ),
        this.col(
          this.menuBtn('Theorem', 'Theorem, lemma, definition, proof… block', [
            ['env-theorem', 'Theorem'],
            ['env-lemma', 'Lemma'],
            ['env-corollary', 'Corollary'],
            ['env-proposition', 'Proposition'],
            ['env-definition', 'Definition'],
            ['env-example', 'Example'],
            ['env-remark', 'Remark'],
            ['env-proof', 'Proof'],
          ]),
          this.btn({ cmd: 'math-toggle-display', label: '⇄ Block' }),
        ),
      ),
      this.group('Draw', this.btn({ cmd: 'insert-drawing', html: `<span class="rb-big rb-draw-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3-6 6 2 9-3s4-7 7-6"/><path d="M14 21l1.2-3.8L20 12.4l2.6 2.6-4.8 4.8z"/></svg></span><span>Drawing</span>`, cls: 'rb-tall', title: 'Insert drawing area' })),
      this.group(
        'Insert math',
        h(
          'div.rb-grid.math-grid',
          {},
          ...structures.map(([latex, preview, title]) => this.mathBtn(latex, title, 'rb-struct', preview)),
          matrixBtn,
          ...symbols.map(([l, t]) => this.mathBtn(l, t, 'rb-sym')),
          morePal,
        ),
      ),
    );

    const right = h(
      'div.rb-right',
      {},
      this.btn({ cmd: 'quick-search', html: '<span class="qs-glyph">⌕</span><span class="rb-search-label">Search</span>', cls: 'rb-search', title: 'Quick search: symbols, commands, styles, macros' }),
      this.btn({ cmd: 'help-feedback', html: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="rb-feedback-label">Feedback</span>', cls: 'rb-feedback', title: 'Report an issue or suggest a feature' }),
      this.btn({ cmd: 'math-keyboard', label: '⌨', cls: 'rb-round', title: 'Math keyboard' }),
      this.btn({ cmd: 'help-shortcuts', label: '?', cls: 'rb-round', title: 'Shortcuts & tips' }),
      this.btn({ cmd: 'view-theme', label: '◐', cls: 'rb-round', title: 'Toggle dark mode' }),
      this.btn({ cmd: 'app-settings', label: '⚙', cls: 'rb-round', title: 'Settings: font, math notation, typing' }),
    );

    const brand = h(
      'button.rb-brand',
      { title: 'Home: new, open and recent documents', 'aria-label': 'Home', onclick: () => runCommand('app-home') },
      h('span.logo', { html: LOGO_SVG }),
      h('span', {}, 'crunchpad'),
    );
    this.root.replaceChildren(brand, left, right);
  }


  /** Refresh toggle/active states after each editor transaction. */
  update() {
    for (const { el, cmd } of this.buttons) {
      const c = getCommand(cmd);
      if (!c) continue;
      if (c.active) {
        const active = c.active();
        el.classList.toggle('active', active);
        el.setAttribute('aria-pressed', String(active));
      }
      const enabled = c.enabled?.() ?? true;
      (el as HTMLButtonElement).disabled = !enabled;
    }
  }
}
