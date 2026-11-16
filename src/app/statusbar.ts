import type { Node as PMNode } from 'prosemirror-model';
import { h } from './dom';

export interface StatusDeps {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  openSearch: () => void;
}

export class StatusBar {
  private fileEl = h('span.sb-file');
  private countEl = h('span.sb-count');
  private noticeEl = h('span.sb-notice', { role: 'status', 'aria-live': 'polite' });
  private zoomEl = h('button.sb-zoom-val', { title: 'Reset zoom' });
  private noticeTimer = 0;
  private lastDoc: PMNode | null = null;

  constructor(root: HTMLElement, deps: StatusDeps) {
    this.zoomEl.addEventListener('click', deps.zoomReset);
    root.replaceChildren(
      h('div.sb-left', {}, this.fileEl, this.countEl),
      this.noticeEl,
      h(
        'div.sb-right',
        {},
        h('button.sb-hint', { onclick: deps.openSearch, title: 'Open quick search' }, h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'Space'), ' quick search'),
        h('div.sb-zoom', {}, h('button', { onclick: deps.zoomOut, title: 'Zoom out', 'aria-label': 'Zoom out' }, '−'), this.zoomEl, h('button', { onclick: deps.zoomIn, title: 'Zoom in', 'aria-label': 'Zoom in' }, '+')),
      ),
    );
  }

  update(doc: PMNode, file: { name: string; dirty: boolean }, zoom: number) {
    this.fileEl.textContent = file.name;
    this.fileEl.classList.toggle('dirty', file.dirty);
    this.fileEl.title = file.dirty ? 'Unsaved changes' : 'Saved';
    this.zoomEl.textContent = `${Math.round(zoom * 100)}%`;
    if (doc === this.lastDoc) return;
    this.lastDoc = doc;
    let eq = 0;
    doc.descendants((n) => {
      if (n.type.name === 'math_inline' || n.type.name === 'math_display') eq++;
      return true;
    });
    const words = doc.textBetween(0, doc.content.size, ' ', ' ').split(/\s+/).filter(Boolean).length;
    this.countEl.textContent = `${words} word${words === 1 ? '' : 's'} · ${eq} equation${eq === 1 ? '' : 's'}`;
  }

  notice(msg: string) {
    this.noticeEl.textContent = msg;
    this.noticeEl.classList.add('show');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => this.noticeEl.classList.remove('show'), 4000);
  }
}
