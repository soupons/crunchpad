import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { NodeSelection } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';

/**
 * Freehand drawing areas. A drawing is a block node whose attrs hold its size,
 * position and a list of vector shapes; it renders as SVG.
 *
 * Two placements ("wrap"):
 *  - 'block': sits between paragraphs and pushes text down; dragging it moves it
 *    to the gap between paragraphs nearest the drop point (any x offset).
 *  - 'front': floats in front of the text at any (x, y) on the page.
 * Coordinates are CSS px at 100% zoom.
 */

export type Tool = 'move' | 'pen' | 'highlighter' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'eraser';

export type Shape =
  /** Freehand stroke: flat [x0, y0, x1, y1, ...]; `o` = opacity (highlighter). */
  | { t: 'pen'; c: string; w: number; o?: number; p: number[] }
  | { t: 'line' | 'arrow' | 'rect' | 'ellipse'; c: string; w: number; f?: boolean; x1: number; y1: number; x2: number; y2: number };

export interface DrawingAttrs {
  width: number;
  height: number;
  x: number;
  y: number;
  wrap: 'block' | 'front';
  bg: 'none' | 'white';
  shapes: Shape[];
}

/** 'auto' = the page's text colour on screen (black in light mode, white in dark), black when exported. */
export const DRAWING_COLORS = ['auto', '#c62828', '#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a', '#00838f', '#757575'];
const WIDTHS = [2, 4, 8];

// ---- SVG rendering (screen + export) --------------------------------------------------

const r1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/[^#0-9a-zA-Z(),. ]/g, '');

function penPath(p: number[]): string {
  if (p.length < 4) return `M${r1(p[0])} ${r1(p[1])}l0.01 0`;
  let d = `M${r1(p[0])} ${r1(p[1])}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2;
    const my = (p[i + 1] + p[i + 3]) / 2;
    d += `Q${r1(p[i])} ${r1(p[i + 1])} ${r1(mx)} ${r1(my)}`;
  }
  return d + `L${r1(p[p.length - 2])} ${r1(p[p.length - 1])}`;
}

function arrowHead(s: { x1: number; y1: number; x2: number; y2: number; w: number }) {
  const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  const len = Math.max(10, s.w * 4);
  const spread = 0.42;
  const pt = (ang: number) => [s.x2 - len * Math.cos(a + ang), s.y2 - len * Math.sin(a + ang)];
  const [ax, ay] = pt(spread);
  const [bx, by] = pt(-spread);
  // Stop the shaft inside the head so the round cap doesn't poke through the tip.
  const back = Math.min(len * 0.7, Math.hypot(s.x2 - s.x1, s.y2 - s.y1));
  return { points: `${r1(s.x2)},${r1(s.y2)} ${r1(ax)},${r1(ay)} ${r1(bx)},${r1(by)}`, ex: s.x2 - back * Math.cos(a), ey: s.y2 - back * Math.sin(a) };
}

export function shapeSvg(s: Shape): string {
  const c = s.c === 'auto' ? 'currentColor' : esc(s.c);
  const stroke = `stroke="${c}" stroke-width="${s.w}" stroke-linecap="round" stroke-linejoin="round"`;
  switch (s.t) {
    case 'pen':
      return `<path d="${penPath(s.p)}" fill="none" ${stroke}${s.o != null ? ` stroke-opacity="${s.o}"` : ''}/>`;
    case 'line':
      return `<line x1="${r1(s.x1)}" y1="${r1(s.y1)}" x2="${r1(s.x2)}" y2="${r1(s.y2)}" ${stroke}/>`;
    case 'arrow': {
      const h = arrowHead(s);
      return `<line x1="${r1(s.x1)}" y1="${r1(s.y1)}" x2="${r1(h.ex)}" y2="${r1(h.ey)}" ${stroke}/><polygon points="${h.points}" fill="${c}" stroke="${c}" stroke-width="1" stroke-linejoin="round"/>`;
    }
    case 'rect': {
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
      const fill = s.f ? `fill="${c}" fill-opacity="0.25"` : 'fill="none"';
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.abs(s.x2 - s.x1))}" height="${r1(Math.abs(s.y2 - s.y1))}" rx="2" ${fill} ${stroke}/>`;
    }
    case 'ellipse': {
      const fill = s.f ? `fill="${c}" fill-opacity="0.25"` : 'fill="none"';
      return `<ellipse cx="${r1((s.x1 + s.x2) / 2)}" cy="${r1((s.y1 + s.y2) / 2)}" rx="${r1(Math.abs(s.x2 - s.x1) / 2)}" ry="${r1(Math.abs(s.y2 - s.y1) / 2)}" ${fill} ${stroke}/>`;
    }
  }
}

/** Standalone SVG document for a drawing. */
export function drawingSvg(a: DrawingAttrs): string {
  const bg = a.bg === 'white' ? `<rect width="100%" height="100%" fill="#fff"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" color="#1b1b1f" width="${a.width}" height="${a.height}" viewBox="0 0 ${a.width} ${a.height}">${bg}${a.shapes.map(shapeSvg).join('')}</svg>`;
}

/** TikZ code for a drawing (LaTeX export). 1px = 0.75pt, y axis flipped. */
export function drawingTikz(a: DrawingAttrs): string {
  const rgb = (hex: string) => {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    const [r, g, b] = m ? [m[1], m[2], m[3]].map((x) => parseInt(x, 16)) : [0, 0, 0];
    return `{rgb,255:red,${r};green,${g};blue,${b}}`;
  };
  const P = (x: number, y: number) => `(${r1(x)},${r1(a.height - y)})`;
  const lines = a.shapes.map((s) => {
    const opts = [`draw=${rgb(s.c)}`, `line width=${r1(s.w * 0.75)}pt`, 'line cap=round', 'line join=round'];
    if (s.t === 'pen') {
      if (s.o != null) opts.push(`draw opacity=${s.o}`);
      const pts: string[] = [];
      const step = Math.max(1, Math.floor(s.p.length / 2 / 300)) * 2; // keep files reasonable
      for (let i = 0; i < s.p.length; i += step) pts.push(P(s.p[i], s.p[i + 1]));
      if (pts.length === 1) pts.push(pts[0]);
      return `  \\draw[${opts.join(', ')}] plot[smooth, tension=0.4] coordinates {${pts.join(' ')}};`;
    }
    if (s.f) opts.push(`fill=${rgb(s.c)}`, 'fill opacity=0.25');
    switch (s.t) {
      case 'line':
        return `  \\draw[${opts.join(', ')}] ${P(s.x1, s.y1)} -- ${P(s.x2, s.y2)};`;
      case 'arrow':
        return `  \\draw[${opts.join(', ')}, -{Stealth[length=${r1(Math.max(10, s.w * 4) * 0.75)}pt]}] ${P(s.x1, s.y1)} -- ${P(s.x2, s.y2)};`;
      case 'rect':
        return `  \\draw[${opts.join(', ')}] ${P(s.x1, s.y1)} rectangle ${P(s.x2, s.y2)};`;
      case 'ellipse':
        return `  \\draw[${opts.join(', ')}] ${P((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2)} ellipse [x radius=${r1(Math.abs(s.x2 - s.x1) / 2)}, y radius=${r1(Math.abs(s.y2 - s.y1) / 2)}];`;
    }
  });
  return [
    '\\begin{center}',
    '\\begin{tikzpicture}[x=0.75pt, y=0.75pt]',
    `  \\useasboundingbox (0,0) rectangle (${a.width},${a.height});`,
    ...lines,
    '\\end{tikzpicture}',
    '\\end{center}',
  ].join('\n');
}

// ---- Hit testing (eraser) --------------------------------------------------------------

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hits(s: Shape, x: number, y: number): boolean {
  const tol = Math.max(6, s.w / 2 + 4);
  if (s.t === 'pen') {
    if (s.p.length < 4) return Math.hypot(x - s.p[0], y - s.p[1]) < tol;
    for (let i = 0; i < s.p.length - 2; i += 2) if (distToSeg(x, y, s.p[i], s.p[i + 1], s.p[i + 2], s.p[i + 3]) < tol) return true;
    return false;
  }
  if (s.t === 'line' || s.t === 'arrow') return distToSeg(x, y, s.x1, s.y1, s.x2, s.y2) < tol;
  const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2), y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
  if (s.t === 'rect') {
    if (s.f && x >= x1 && x <= x2 && y >= y1 && y <= y2) return true;
    return (
      distToSeg(x, y, x1, y1, x2, y1) < tol || distToSeg(x, y, x2, y1, x2, y2) < tol ||
      distToSeg(x, y, x2, y2, x1, y2) < tol || distToSeg(x, y, x1, y2, x1, y1) < tol
    );
  }
  // ellipse: compare normalized radius
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.max(1, (x2 - x1) / 2), ry = Math.max(1, (y2 - y1) / 2);
  const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
  if (s.f && d <= 1) return true;
  return Math.abs(d - 1) * Math.min(rx, ry) < tol;
}

// ---- Shared tool state (remembered across drawings) -----------------------------------

const toolState = { tool: 'pen' as Tool, color: DRAWING_COLORS[0], width: 4, fill: false };

const ICONS: Record<Tool, string> = {
  move: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
  pen: '<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>',
  highlighter: '<path d="M9 15l-4 4h6l2-2"/><path d="M8 13l7-9 5 5-9 7z"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.5"/>',
  eraser: '<path d="M8 20h12M5 15l9-10 6 6-8 9H9z"/><path d="M10 10l6 6"/>',
};
const TOOL_TITLES: Record<Tool, string> = {
  move: 'Move drawing (drag)',
  pen: 'Pen',
  highlighter: 'Highlighter',
  line: 'Line (Shift: 45° steps)',
  arrow: 'Arrow (Shift: 45° steps)',
  rect: 'Rectangle (Shift: square)',
  ellipse: 'Ellipse (Shift: circle)',
  eraser: 'Eraser (click or drag over shapes)',
};
const svgIcon = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** Node views notify each other when the shared tool state changes (to refresh toolbars). */
const allViews = new Set<DrawingView>();

/** Current page zoom (the page element carries `--zoom`). */
function pageZoom(el: Element | null): number {
  const page = el?.closest('.page') as HTMLElement | null;
  return parseFloat(page?.style.getPropertyValue('--zoom') ?? '') || 1;
}

// ---- Node view ----------------------------------------------------------------------------

export class DrawingView implements NodeView {
  dom: HTMLElement;
  private box: HTMLElement;
  private svg: SVGSVGElement;
  private shapesG: SVGGElement;
  private draftG: SVGGElement;
  private toolbar: HTMLElement;
  private hint: HTMLElement;
  private attrs: DrawingAttrs;
  private active = false;
  private onDocDown = (e: PointerEvent) => {
    if (!this.dom.contains(e.target as Node)) this.setActive(false);
  };
  private onZoom = () => this.layout();

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.attrs = node.attrs as DrawingAttrs;
    this.dom = document.createElement('div');
    this.dom.className = 'drawing-anchor';
    this.dom.contentEditable = 'false';

    this.box = document.createElement('div');
    this.box.className = 'drawing-box';
    this.box.tabIndex = 0;
    this.box.setAttribute('role', 'img');
    this.box.setAttribute('aria-label', 'Drawing');

    const NS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.classList.add('drawing-svg');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.shapesG = document.createElementNS(NS, 'g');
    this.draftG = document.createElementNS(NS, 'g');
    this.svg.append(this.shapesG, this.draftG);

    this.hint = document.createElement('div');
    this.hint.className = 'drawing-hint';
    this.hint.textContent = 'Drawing: click and drag to draw';

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'drawing-toolbar';

    const resize = document.createElement('div');
    resize.className = 'drawing-resize';
    resize.title = 'Drag to resize';

    this.box.append(this.toolbar, this.svg, this.hint, resize);
    this.dom.append(this.box);

    this.buildToolbar();
    this.render();
    this.layout();
    requestAnimationFrame(() => this.layout());

    this.svg.addEventListener('pointerdown', this.onPointerDown);
    resize.addEventListener('pointerdown', this.onResizeDown);
    this.toolbar.addEventListener('pointerdown', (e) => {
      // Empty toolbar space (and the grip) drags the whole drawing.
      if ((e.target as HTMLElement).closest('button, input')) return;
      this.startMove(e);
    });
    this.box.addEventListener('pointerdown', () => this.setActive(true));
    this.box.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('mathmirror:zoom', this.onZoom);
    allViews.add(this);
  }

  // ---- NodeView interface ----

  update(node: PMNode) {
    if (node.type.name !== 'drawing') return false;
    const prev = this.attrs;
    this.attrs = node.attrs as DrawingAttrs;
    if (prev.shapes !== this.attrs.shapes || prev.bg !== this.attrs.bg) this.render();
    this.layout();
    this.syncToolbar();
    return true;
  }
  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
    this.setActive(true);
  }
  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
  }
  stopEvent(e: Event) {
    return this.box.contains(e.target as Node);
  }
  ignoreMutation() {
    return true;
  }
  destroy() {
    document.removeEventListener('pointerdown', this.onDocDown, true);
    window.removeEventListener('mathmirror:zoom', this.onZoom);
    allViews.delete(this);
  }

  // ---- State ----

  private setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    this.box.classList.toggle('active', on);
    if (on) {
      document.addEventListener('pointerdown', this.onDocDown, true);
      this.syncToolbar();
    } else {
      document.removeEventListener('pointerdown', this.onDocDown, true);
    }
  }

  private dispatchAttrs(patch: Partial<DrawingAttrs>) {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }));
  }

  private deleteSelf() {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + node.nodeSize).scrollIntoView());
    this.view.focus();
  }

  // ---- Layout ----

  private layout() {
    const z = pageZoom(this.view.dom);
    const a = this.attrs;
    this.box.style.width = `${a.width * z}px`;
    this.box.style.height = `${a.height * z}px`;
    this.svg.setAttribute('viewBox', `0 0 ${a.width} ${a.height}`);
    this.box.classList.toggle('front', a.wrap === 'front');
    this.dom.classList.toggle('front', a.wrap === 'front');
    if (a.wrap === 'block') {
      this.dom.style.height = `${a.height * z}px`;
      this.box.style.left = `${a.x * z}px`;
      this.box.style.top = '0px';
    } else {
      this.dom.style.height = '0px';
      // Position relative to the page, whatever the box's containing block is.
      const page = this.dom.closest('.page') as HTMLElement | null;
      const op = this.box.offsetParent as HTMLElement | null;
      let dx = 0, dy = 0;
      if (page && op && op !== page) {
        const pr = page.getBoundingClientRect();
        const or = op.getBoundingClientRect();
        dx = or.left - pr.left + op.clientLeft;
        dy = or.top - pr.top + op.clientTop;
      }
      this.box.style.left = `${a.x * z - dx}px`;
      this.box.style.top = `${a.y * z - dy}px`;
    }
  }

  private render() {
    const a = this.attrs;
    this.shapesG.innerHTML =
      (a.bg === 'white' ? `<rect width="${a.width}" height="${a.height}" fill="#fff"/>` : '') + a.shapes.map(shapeSvg).join('');
    this.box.classList.toggle('empty', a.shapes.length === 0);
    this.box.classList.toggle('bg-white', a.bg === 'white');
  }

  // ---- Toolbar ----

  private btn(html: string, title: string, onClick: () => void, cls = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `dt-btn ${cls}`;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = html;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
      this.box.focus({ preventScroll: true });
    });
    return b;
  }

  private buildToolbar() {
    const tb = this.toolbar;
    const sep = () => Object.assign(document.createElement('span'), { className: 'dt-sep' });
    const grip = document.createElement('span');
    grip.className = 'dt-grip';
    grip.title = 'Drag to move';
    grip.textContent = '⠿';
    tb.append(grip);

    for (const t of Object.keys(ICONS) as Tool[]) {
      const b = this.btn(svgIcon(ICONS[t]), TOOL_TITLES[t], () => setTool(t), 'dt-tool');
      b.dataset.tool = t;
      tb.append(b);
    }
    tb.append(sep());
    for (const c of DRAWING_COLORS) {
      const b = this.btn(`<span class="dt-swatch${c === 'auto' ? ' auto' : ''}" style="background:${c === 'auto' ? 'currentColor' : c}"></span>`, c === 'auto' ? 'Ink (black; white in dark mode)' : `Color ${c}`, () => setColor(c), 'dt-color');
      b.dataset.color = c;
      tb.append(b);
    }
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.className = 'dt-custom';
    custom.title = 'Custom color';
    custom.setAttribute('aria-label', 'Custom color');
    custom.addEventListener('input', () => setColor(custom.value));
    tb.append(custom, sep());
    for (const w of WIDTHS) {
      const b = this.btn(`<span class="dt-dot" style="width:${w + 2}px;height:${w + 2}px"></span>`, `Thickness ${w}`, () => setWidth(w), 'dt-width');
      b.dataset.width = String(w);
      tb.append(b);
    }
    tb.append(
      this.btn(svgIcon('<rect x="4" y="6" width="16" height="12" rx="1" fill="currentColor" fill-opacity="0.35"/>'), 'Fill rectangles and ellipses', () => setFill(!toolState.fill), 'dt-fill'),
      sep(),
      this.btn('<span class="dt-text">Bg</span>', 'White background', () => this.dispatchAttrs({ bg: this.attrs.bg === 'white' ? 'none' : 'white' }), 'dt-bg'),
      this.btn(svgIcon('<rect x="7" y="7" width="13" height="13" rx="1"/><path d="M4 14V4h10"/>'), 'In front of text: place anywhere on the page (otherwise text flows above and below)', () => this.toggleWrap(), 'dt-wrap'),
      sep(),
      this.btn(svgIcon('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'), 'Undo (Ctrl+Z)', () => undo(this.view.state, this.view.dispatch)),
      this.btn('<span class="dt-text">Clear</span>', 'Erase everything', () => this.attrs.shapes.length && this.dispatchAttrs({ shapes: [] })),
      this.btn(svgIcon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'), 'Delete drawing', () => this.deleteSelf(), 'dt-danger'),
    );
  }

  /** Reflect the shared tool state and this drawing's options in the toolbar. */
  syncToolbar() {
    this.toolbar.querySelectorAll<HTMLElement>('.dt-tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === toolState.tool));
    this.toolbar.querySelectorAll<HTMLElement>('.dt-color').forEach((b) => b.classList.toggle('on', b.dataset.color === toolState.color));
    this.toolbar.querySelectorAll<HTMLElement>('.dt-width').forEach((b) => b.classList.toggle('on', b.dataset.width === String(toolState.width)));
    this.toolbar.querySelector('.dt-fill')?.classList.toggle('on', toolState.fill);
    this.toolbar.querySelector('.dt-bg')?.classList.toggle('on', this.attrs.bg === 'white');
    this.toolbar.querySelector('.dt-wrap')?.classList.toggle('on', this.attrs.wrap === 'front');
    const custom = this.toolbar.querySelector<HTMLInputElement>('.dt-custom');
    if (custom && !DRAWING_COLORS.includes(toolState.color)) custom.value = toolState.color;
    custom?.classList.toggle('on', !DRAWING_COLORS.includes(toolState.color));
    this.box.dataset.tool = toolState.tool;
  }

  // ---- Drawing ----

  private local(e: PointerEvent): [number, number] {
    const r = this.svg.getBoundingClientRect();
    return [((e.clientX - r.left) * this.attrs.width) / r.width, ((e.clientY - r.top) * this.attrs.height) / r.height];
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.setActive(true);
    this.box.focus({ preventScroll: true });
    const tool = toolState.tool;
    if (tool === 'move') return this.startMove(e);
    this.svg.setPointerCapture(e.pointerId);
    const [x0, y0] = this.local(e);

    if (tool === 'eraser') {
      let shapes = this.attrs.shapes;
      const erase = (x: number, y: number) => {
        const next = shapes.filter((s) => !hits(s, x, y));
        if (next.length !== shapes.length) {
          shapes = next;
          this.shapesG.innerHTML = shapes.map(shapeSvg).join('');
        }
      };
      erase(x0, y0);
      const move = (ev: PointerEvent) => erase(...this.local(ev));
      const up = () => {
        this.svg.removeEventListener('pointermove', move);
        this.svg.removeEventListener('pointerup', up);
        this.svg.removeEventListener('pointercancel', up);
        if (shapes !== this.attrs.shapes) this.dispatchAttrs({ shapes });
        else this.render();
      };
      this.svg.addEventListener('pointermove', move);
      this.svg.addEventListener('pointerup', up);
      this.svg.addEventListener('pointercancel', up);
      return;
    }

    const { color: c, width: w, fill } = toolState;
    let shape: Shape;
    if (tool === 'pen' || tool === 'highlighter') {
      shape = tool === 'pen' ? { t: 'pen', c, w, p: [r1(x0), r1(y0)] } : { t: 'pen', c, w: w * 4, o: 0.35, p: [r1(x0), r1(y0)] };
    } else {
      shape = { t: tool, c, w, x1: r1(x0), y1: r1(y0), x2: r1(x0), y2: r1(y0), ...(fill && (tool === 'rect' || tool === 'ellipse') ? { f: true } : {}) };
    }
    const draw = () => (this.draftG.innerHTML = shapeSvg(shape));
    draw();

    const move = (ev: PointerEvent) => {
      const events = ev.getCoalescedEvents?.() ?? [ev];
      if (shape.t === 'pen') {
        for (const ce of events.length ? events : [ev]) {
          const [x, y] = this.local(ce);
          const p = shape.p;
          if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) >= 1.5) p.push(r1(x), r1(y));
        }
      } else {
        let [x, y] = this.local(ev);
        if (ev.shiftKey) [x, y] = constrain(shape, x, y);
        shape.x2 = r1(x);
        shape.y2 = r1(y);
      }
      draw();
    };
    const up = () => {
      this.svg.removeEventListener('pointermove', move);
      this.svg.removeEventListener('pointerup', up);
      this.svg.removeEventListener('pointercancel', up);
      this.draftG.innerHTML = '';
      const tiny = shape.t !== 'pen' && Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) < 2;
      if (!tiny) this.dispatchAttrs({ shapes: [...this.attrs.shapes, shape] });
    };
    this.svg.addEventListener('pointermove', move);
    this.svg.addEventListener('pointerup', up);
    this.svg.addEventListener('pointercancel', up);
  };

  // ---- Move / resize ----

  private startMove(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    this.setActive(true);
    const target = e.currentTarget as HTMLElement | null;
    const el = target ?? this.box;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    this.box.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      this.box.style.transform = `translate(${ev.clientX - sx}px, ${ev.clientY - sy}px)`;
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      this.box.classList.remove('dragging');
      const rect = this.box.getBoundingClientRect(); // includes the drag transform
      this.box.style.transform = '';
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return;
      this.placeAt(rect, this.attrs.wrap);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  private toggleWrap() {
    this.placeAt(this.box.getBoundingClientRect(), this.attrs.wrap === 'front' ? 'block' : 'front');
  }

  /** Commit a new on-screen position (client rect of the box) in the given wrap mode. */
  private placeAt(rect: DOMRect, wrap: DrawingAttrs['wrap']) {
    const pos = this.getPos();
    const page = this.dom.closest('.page') as HTMLElement | null;
    if (pos == null || !page) return;
    const z = pageZoom(this.view.dom);
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;

    if (wrap === 'front') {
      const pr = page.getBoundingClientRect();
      const x = Math.round((rect.left - pr.left) / z);
      const y = Math.max(0, Math.round((rect.top - pr.top) / z));
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, wrap, x, y }));
      return;
    }

    // Block mode: move the node to the gap between top-level blocks nearest the drop point.
    const { doc } = this.view.state;
    let insertAt = doc.content.size;
    let offset = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const child = doc.child(i);
      if (offset !== pos) {
        const dom = this.view.nodeDOM(offset) as HTMLElement | null;
        const r = dom?.getBoundingClientRect?.();
        if (r && r.height > 0 && rect.top < r.top + r.height / 2) {
          insertAt = offset;
          break;
        }
      }
      offset += child.nodeSize;
    }
    const docLeft = this.view.dom.getBoundingClientRect().left;
    const contentWidth = this.view.dom.clientWidth / z;
    let x = Math.round((rect.left - docLeft) / z);
    x = Math.max(Math.min(0, contentWidth - node.attrs.width), Math.min(x, Math.max(0, contentWidth - node.attrs.width)));
    const attrs = { ...node.attrs, wrap, x };
    let tr = this.view.state.tr;
    if (insertAt === pos || insertAt === pos + node.nodeSize) {
      tr = tr.setNodeMarkup(pos, undefined, attrs);
    } else {
      tr = tr.delete(pos, pos + node.nodeSize);
      const at = tr.mapping.map(insertAt);
      tr = tr.insert(at, node.type.create(attrs));
      tr = tr.setSelection(NodeSelection.create(tr.doc, at));
    }
    this.view.dispatch(tr.scrollIntoView());
  }

  private onResizeDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.setActive(true);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const z = pageZoom(this.view.dom);
    const sx = e.clientX, sy = e.clientY;
    const w0 = this.attrs.width, h0 = this.attrs.height;
    let w = w0, h = h0;
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.max(80, w0 + (ev.clientX - sx) / z));
      h = Math.round(Math.max(50, h0 + (ev.clientY - sy) / z));
      this.box.style.width = `${w * z}px`;
      this.box.style.height = `${h * z}px`;
      this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      if (this.attrs.wrap === 'block') this.dom.style.height = `${h * z}px`;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (w !== w0 || h !== h0) this.dispatchAttrs({ width: w, height: h });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== this.box) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelf();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.setActive(false);
      const pos = this.getPos();
      if (pos != null) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
      this.view.focus();
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      (e.shiftKey ? redo : undo)(this.view.state, this.view.dispatch);
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo(this.view.state, this.view.dispatch);
    }
  };
}

function constrain(s: Extract<Shape, { x1: number }>, x: number, y: number): [number, number] {
  const dx = x - s.x1, dy = y - s.y1;
  if (s.t === 'rect' || s.t === 'ellipse') {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    return [s.x1 + Math.sign(dx || 1) * d, s.y1 + Math.sign(dy || 1) * d];
  }
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return [s.x1 + len * Math.cos(a), s.y1 + len * Math.sin(a)];
}

function setTool(t: Tool) {
  toolState.tool = t;
  allViews.forEach((v) => v.syncToolbar());
}
function setColor(c: string) {
  toolState.color = c;
  if (toolState.tool === 'eraser' || toolState.tool === 'move') toolState.tool = 'pen';
  allViews.forEach((v) => v.syncToolbar());
}
function setWidth(w: number) {
  toolState.width = w;
  allViews.forEach((v) => v.syncToolbar());
}
function setFill(f: boolean) {
  toolState.fill = f;
  allViews.forEach((v) => v.syncToolbar());
}

export const drawingNodeView = (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
  new DrawingView(node, view, getPos);
