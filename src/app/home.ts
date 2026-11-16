/**
 * Home page, opened from the logo: start a new document, open one, reopen a
 * recent one, change settings, or visit the project on GitHub.
 */
import { h } from './dom';
import { LOGO_SVG } from './logo';
import { REPO_URL } from './feedback';
import { shortcutLabel, getCommand } from './registry';
import { canReopenFiles, onRecentChanged, recentDocs, removeRecent, type RecentDoc } from './recent';
import { isDesktop } from './platform';

export type OpenResult = 'ok' | 'cancel' | 'missing';

export interface HomeDeps {
  currentName: () => string;
  newDoc: () => Promise<boolean>;
  open: () => Promise<boolean>;
  openRecent: (doc: RecentDoc) => Promise<OpenResult>;
  settings: () => void;
  /** Called after the page closes, to give focus back to the editor. */
  onHide: () => void;
}

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const ICONS = {
  newDoc: icon('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/>'),
  open: icon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 7v11a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L22 12H7.4a2 2 0 0 0-1.9 1.4L3 20"/>'),
  settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  github:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>',
};

function timeAgo(at: number): string {
  if (!at) return '';
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
}

export class Home {
  isOpen = false;
  private notice: HTMLElement = h('p.home-notice', { role: 'status' });
  private list: HTMLElement = h('div.home-recent');
  private back: HTMLButtonElement = h('button.btn.home-back');

  constructor(
    private root: HTMLElement,
    private deps: HomeDeps,
  ) {
    root.hidden = true;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Home');
    this.render();
    onRecentChanged(() => this.isOpen && this.renderRecent());
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    });
  }

  show() {
    this.isOpen = true;
    this.back.textContent = `← Back to ${this.deps.currentName()}`;
    this.setNotice('');
    this.renderRecent();
    this.root.hidden = false;
    document.body.classList.add('home-open');
    this.root.scrollTop = 0;
    this.root.querySelector<HTMLElement>('.home-action')?.focus();
  }

  hide() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.hidden = true;
    document.body.classList.remove('home-open');
    this.deps.onHide();
  }

  toggle() {
    if (this.isOpen) this.hide();
    else this.show();
  }

  private setNotice(text: string) {
    this.notice.textContent = text;
    this.notice.hidden = !text;
  }

  private action(label: string, sub: string, svg: string, run: () => void, cls = '') {
    return h(
      'button.home-action',
      { class: `home-action ${cls}`, onclick: run },
      h('span.home-action-icon', { html: svg }),
      h('span.home-action-text', {}, h('span.home-action-label', {}, label), h('span.home-action-sub', {}, sub)),
    );
  }

  private render() {
    const sc = (id: string) => shortcutLabel(getCommand(id)?.shortcut);
    this.back.onclick = () => this.hide();

    const header = h(
      'header.home-header',
      {},
      h('div.home-brand', {}, h('span.home-logo', { html: LOGO_SVG }), h('span', {}, 'crunchpad')),
      this.back,
    );

    const actions = h(
      'div.home-actions',
      {},
      this.action('New document', sc('file-new') || 'Blank page', ICONS.newDoc, () => void this.deps.newDoc(), 'primary'),
      this.action('Open document', sc('file-open') || 'From your computer', ICONS.open, () => void this.deps.open()),
      this.action('Settings', 'Font, notation, typing', ICONS.settings, () => this.deps.settings()),
      this.action('GitHub', 'Source, issues, ideas', ICONS.github, () => void window.open(REPO_URL, '_blank', 'noopener')),
    );

    const main = h(
      'div.home-main',
      {},
      actions,
      h('h2.home-heading', {}, 'Previous documents'),
      this.notice,
      this.list,
    );
    this.root.replaceChildren(header, main);
  }

  private renderRecent() {
    const docs = recentDocs();
    if (!docs.length) {
      const msg = canReopenFiles()
        ? 'Documents you open or save will show up here.'
        : 'This browser can’t reopen files later, so there’s no recent list. Use Chrome or Edge, or the desktop app, to keep one.';
      this.list.replaceChildren(h('p.home-empty', {}, msg));
      return;
    }
    this.list.replaceChildren(
      ...docs.map((d) => {
        const where = d.path ? d.path.replace(/[\\/][^\\/]*$/, '') : isDesktop ? '' : 'Saved on this computer';
        const open = h(
          'button.home-doc',
          { title: d.path ?? d.name, onclick: () => void this.openRecent(d) },
          h('span.home-doc-icon', { html: ICONS.doc }),
          h('span.home-doc-text', {}, h('span.home-doc-name', {}, d.name), where ? h('span.home-doc-path', {}, where) : null),
          h('span.home-doc-time', {}, timeAgo(d.at)),
        );
        const remove = h(
          'button.icon-btn.home-doc-remove',
          { title: 'Remove from list', 'aria-label': `Remove ${d.name} from list`, onclick: () => removeRecent(d.id) },
          '✕',
        );
        return h('div.home-doc-row', {}, open, remove);
      }),
    );
  }

  private async openRecent(d: RecentDoc) {
    this.setNotice('');
    const r = await this.deps.openRecent(d);
    if (r === 'missing') {
      removeRecent(d.id);
      this.setNotice(`Couldn’t find “${d.name}”. It may have been moved or deleted, so it was removed from the list.`);
    }
  }
}
