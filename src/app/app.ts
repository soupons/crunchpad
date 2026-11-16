import { EditorState, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Node as PMNode, Slice } from 'prosemirror-model';
import { undo, redo } from 'prosemirror-history';
import { selectAll } from 'prosemirror-commands';
import type { MathfieldElement } from 'mathlive';

import { schema, ENV_KINDS, type EnvKind } from '../editor/schema';
import { buildPlugins } from '../editor/plugins';
import { mathHooks, mathNodeViews } from '../editor/mathview';
import * as cmd from '../editor/commands';
import { docFromText } from '../editor/textmath';
import { MATH_CATALOG } from '../math/catalog';
import { focusMathfield, getActiveMathfield, setMathfieldOptions, showVirtualKeyboard } from '../math/mathfield';
import { applyNotation, convertInverseTrig, type NotationPrefs } from '../math/notation';
import { exportOptions, fontCss, getSettings, onSettingsChanged, updateSettings, type Settings } from './settings';

import { register, runCommand, allCommands, installShortcutHandler, shortcutLabel } from './registry';
import { Ribbon } from './ribbon';
import { QuickSearch, type QSItem } from './quicksearch';
import { getMacros, loadMacros, onMacrosChanged, type Macro } from './macros';
import {
  isDialogOpen,
  latexSourceDialog,
  macroManagerDialog,
  matrixDialog,
  shortcutsDialog,
  editMacroDialog,
  openModal,
  settingsDialog,
} from './dialogs';
import { isDesktop, native, openFile, saveAs, saveTo, type FileFilter, type SaveTarget } from './platform';
import { StatusBar } from './statusbar';
import { h } from './dom';
import { exportDocx } from '../export/docx';
import { exportLatex } from '../export/latex';
import { exportHtml } from '../export/html';
import { WELCOME_DOC } from './welcome';

const NATIVE_EXT = 'mathdoc';
const DOC_FILTERS: FileFilter[] = [
  { name: 'MathMirror document', extensions: [NATIVE_EXT] },
  { name: 'Text with $math$ (Markdown, TeX, plain text)', extensions: ['md', 'txt', 'tex'] },
];
const RECOVERY_KEY = 'mathmirror:recovery';

interface FileInfo {
  name: string;
  target: SaveTarget | null;
  dirty: boolean;
}

export class App {
  view!: EditorView;
  ribbon!: Ribbon;
  quick!: QuickSearch;
  status!: StatusBar;
  file: FileInfo = { name: `Untitled.${NATIVE_EXT}`, target: null, dirty: false };
  zoom = 1;
  private qsTarget: MathfieldElement | null = null;
  private recoveryTimer = 0;
  private recentFiles: string[] = [];

  constructor(
    private els: { ribbon: HTMLElement; page: HTMLElement; quick: HTMLElement; status: HTMLElement },
  ) {}

  // ---- Boot -------------------------------------------------------------------

  start() {
    this.applySettings(getSettings());
    onSettingsChanged((st) => this.applySettings(st));
    loadMacros();
    this.registerCommands();

    const initialDoc = this.loadRecovery() ?? PMNode.fromJSON(schema, WELCOME_DOC);
    this.view = new EditorView(this.els.page, {
      state: this.newState(initialDoc),
      nodeViews: mathNodeViews,
      dispatchTransaction: (tr) => this.dispatch(tr),
      attributes: () => ({ class: 'doc', spellcheck: String(getSettings().spellcheck), 'aria-label': 'Document' }),
    });

    mathHooks.overlayOpen = () => this.quick?.isOpen || isDialogOpen();

    this.ribbon = new Ribbon(this.els.ribbon, {
      insertLatex: (l) => cmd.insertMath(this.view, l),
      applyHighlight: (c) => this.exec(cmd.setHighlight(c)),
      applyTextColor: (c) => this.exec(cmd.setTextColor(c)),
    });
    this.quick = new QuickSearch(this.els.quick, {
      items: () => this.searchItems(),
      dynamic: (q) => this.dynamicItems(q),
      onOpen: () => {
        this.qsTarget = getActiveMathfield();
      },
      onClose: (ran) => {
        if (!ran) this.restoreFocus();
      },
    });
    this.status = new StatusBar(this.els.status, {
      zoomIn: () => runCommand('view-zoom-in'),
      zoomOut: () => runCommand('view-zoom-out'),
      zoomReset: () => runCommand('view-zoom-reset'),
      openSearch: () => runCommand('quick-search'),
    });

    installShortcutHandler(
      () => !!getActiveMathfield(),
      () => this.quick.isOpen || isDialogOpen(),
    );
    onMacrosChanged(() => this.registerMacroCommands());

    window.addEventListener('beforeunload', (e) => {
      if (this.file.dirty && !isDesktop) {
        e.preventDefault();
      }
    });

    if (native) {
      native.onMenu((id) => runCommand(id));
      native.onOpenPath((p) => void this.openPath(p));
      void native.getRecent().then((r) => {
        this.recentFiles = r;
      });
    }

    this.refreshUI();
    this.view.focus();
  }

  private newState(doc: PMNode) {
    return EditorState.create({ doc, schema, plugins: buildPlugins() });
  }

  private dispatch(tr: Transaction) {
    const state = this.view.state.apply(tr);
    this.view.updateState(state);
    if (tr.docChanged) {
      this.setDirty(true);
      this.scheduleRecovery();
    }
    this.refreshUI();
  }

  /** Run a ProseMirror command against the editor. */
  exec(command: (s: EditorState, d?: (tr: Transaction) => void, v?: EditorView) => boolean) {
    const mf = getActiveMathfield();
    if (mf) mf.blur();
    command(this.view.state, (tr) => this.view.dispatch(tr), this.view);
    this.view.focus();
  }

  private refreshUI() {
    this.ribbon?.update();
    this.status?.update(this.view.state.doc, this.file, this.zoom);
    const title = `${this.file.dirty ? '• ' : ''}${this.file.name} — MathMirror`;
    document.title = title;
    native?.setTitle(title);
  }

  private setDirty(dirty: boolean) {
    if (this.file.dirty === dirty) return;
    this.file.dirty = dirty;
    native?.setDirty(dirty);
  }

  private restoreFocus() {
    const t = this.qsTarget;
    this.qsTarget = null;
    if (t && t.isConnected) focusMathfield(t);
    else this.view.focus();
  }

  // ---- Theme / zoom -------------------------------------------------------------

  /** Push settings into the page: theme, document font, math options. */
  private applySettings(st: Settings) {
    const root = document.documentElement;
    if (st.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = st.theme;
    root.style.setProperty('--doc-font', fontCss(st.font));
    root.style.setProperty('--doc-size', `${st.fontSize}pt`);
    root.style.setProperty('--doc-line', String(st.lineSpacing));
    root.dataset.eqnum = st.eqNumberStyle;
    setMathfieldOptions({ smartFence: st.smartFence, smartSuperscript: st.smartSuperscript, letterShapeStyle: st.letterShape });
    // Re-evaluates the (function-valued) editor attributes, e.g. spellcheck.
    this.view?.setProps({});
  }

  private toggleTheme() {
    const current =
      document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    updateSettings({ theme: current === 'dark' ? 'light' : 'dark' });
  }

  /** Rewrite arcsin ⇄ sin^{-1} in every equation of the open document. */
  private convertInverseTrig(style: NotationPrefs['inverseTrig']): number {
    const { state } = this.view;
    let tr = state.tr;
    let changed = 0;
    state.doc.descendants((node, pos) => {
      if (node.type !== schema.nodes.math_inline && node.type !== schema.nodes.math_display) return true;
      const latex = convertInverseTrig(node.attrs.latex, style);
      if (latex !== node.attrs.latex) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex });
        changed++;
      }
      return false;
    });
    if (changed) this.view.dispatch(tr);
    return changed;
  }

  private setZoom(z: number) {
    this.zoom = Math.round(Math.max(0.5, Math.min(2.5, z)) * 10) / 10;
    this.els.page.style.setProperty('--zoom', String(this.zoom));
    this.refreshUI();
  }

  // ---- Files ----------------------------------------------------------------------

  private serialize(): string {
    return JSON.stringify({ app: 'MathMirror', version: 1, doc: this.view.state.doc.toJSON() }, null, 1);
  }

  private parseFile(name: string, text: string): PMNode {
    const lower = name.toLowerCase();
    if (lower.endsWith('.mathdoc') || lower.endsWith('.json')) {
      const data = JSON.parse(text);
      return PMNode.fromJSON(schema, data.doc ?? data);
    }
    if (lower.endsWith('.tex')) {
      const body = text.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/)?.[1] ?? text;
      const md = body
        .replace(/\\(sub)*section\*?\{([^}]*)\}/g, (_m, subs: string | undefined, t: string) => `${'#'.repeat(1 + (subs ? subs.length / 3 : 0))} ${t}`)
        .replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, '$$$$$1$$$$')
        .replace(/\\(maketitle|noindent)\b/g, '')
        .replace(/\n{2,}/g, '\n');
      return docFromText(md);
    }
    return docFromText(text);
  }

  private loadDoc(doc: PMNode, name: string, target: SaveTarget | null) {
    this.view.updateState(this.newState(doc));
    this.file = { name, target, dirty: false };
    native?.setDirty(false);
    this.clearRecovery();
    this.refreshUI();
    this.view.focus();
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.file.dirty) return true;
    return new Promise((resolve) => {
      let choice = false;
      openModal(
        'Unsaved changes',
        h('p', {}, `“${this.file.name}” has unsaved changes. Continue without saving?`),
        [
          { label: 'Cancel' },
          {
            label: 'Save first',
            run: async () => {
              choice = await this.save();
            },
          },
          { label: 'Discard changes', danger: true, run: () => void (choice = true) },
        ],
        { onClose: () => resolve(choice) },
      );
    });
  }

  async newDoc() {
    if (!(await this.confirmDiscard())) return;
    this.loadDoc(schema.nodes.doc.create(null, schema.nodes.paragraph.create()), `Untitled.${NATIVE_EXT}`, null);
  }

  async open() {
    if (!(await this.confirmDiscard())) return;
    try {
      const f = await openFile(DOC_FILTERS);
      if (!f) return;
      const doc = this.parseFile(f.name, f.text);
      const isNative = /\.(mathdoc|json)$/i.test(f.name);
      const name = isNative ? f.name : f.name.replace(/\.[^.]+$/, '') + '.' + NATIVE_EXT;
      this.loadDoc(doc, name, isNative ? { name: f.name, path: f.path, handle: f.handle } : null);
      if (f.path) this.addRecent(f.path);
      if (!isNative) this.status.notice(`Imported ${f.name}. Save to keep it as a .${NATIVE_EXT} file.`);
    } catch (err) {
      this.error('Could not open file', err);
    }
  }

  async openPath(path: string) {
    if (!native) return;
    if (!(await this.confirmDiscard())) return;
    try {
      const f = await native.readFile(path);
      if (!f) {
        this.status.notice(`File not found: ${path}`);
        return;
      }
      this.loadDoc(this.parseFile(f.name, f.text), f.name, { name: f.name, path: f.path });
      this.addRecent(f.path);
    } catch (err) {
      this.error('Could not open file', err);
    }
  }

  private addRecent(path: string) {
    this.recentFiles = [path, ...this.recentFiles.filter((p) => p !== path)].slice(0, 10);
    native?.addRecent(path);
  }

  async save(): Promise<boolean> {
    try {
      if (this.file.target && (await saveTo(this.file.target, this.serialize()))) {
        this.setDirty(false);
        this.clearRecovery();
        this.refreshUI();
        this.status.notice('Saved');
        return true;
      }
      return this.saveAs();
    } catch (err) {
      this.error('Could not save', err);
      return false;
    }
  }

  async saveAs(): Promise<boolean> {
    try {
      const t = await saveAs(this.file.name, this.serialize(), [DOC_FILTERS[0]], 'application/json');
      if (!t) return false;
      this.file.target = t.path || t.handle ? t : null;
      this.file.name = t.name;
      if (t.path) this.addRecent(t.path);
      this.setDirty(false);
      this.clearRecovery();
      this.refreshUI();
      this.status.notice(t.path || t.handle ? `Saved ${t.name}` : `Downloaded ${t.name}`);
      return true;
    } catch (err) {
      this.error('Could not save', err);
      return false;
    }
  }

  private baseName() {
    return this.file.name.replace(/\.[^.]+$/, '') || 'Untitled';
  }

  async exportAs(kind: 'docx' | 'latex' | 'html') {
    try {
      const doc = this.view.state.doc;
      const title = this.baseName();
      if (kind === 'docx') {
        const data = await exportDocx(doc, title, exportOptions());
        const t = await saveAs(`${title}.docx`, data, [{ name: 'Word document', extensions: ['docx'] }], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        if (t) this.status.notice(`Exported ${t.name}`);
      } else if (kind === 'latex') {
        const t = await saveAs(`${title}.tex`, exportLatex(doc, title, exportOptions()), [{ name: 'LaTeX', extensions: ['tex'] }], 'application/x-tex');
        if (t) this.status.notice(`Exported ${t.name}`);
      } else {
        const t = await saveAs(`${title}.html`, exportHtml(doc, title, exportOptions()), [{ name: 'Web page', extensions: ['html'] }], 'text/html');
        if (t) this.status.notice(`Exported ${t.name}`);
      }
    } catch (err) {
      this.error('Export failed', err);
    }
  }

  async exportPdf() {
    getActiveMathfield()?.blur();
    document.body.classList.add('printing');
    try {
      if (native) {
        const path = await native.exportPdf(`${this.baseName()}.pdf`);
        if (path) this.status.notice(`Exported ${path}`);
      } else {
        // The browser's print dialog offers "Save as PDF"; print CSS hides the UI.
        await new Promise((r) => setTimeout(r, 50));
        window.print();
      }
    } catch (err) {
      this.error('PDF export failed', err);
    } finally {
      document.body.classList.remove('printing');
    }
  }

  // ---- Crash recovery --------------------------------------------------------------

  private scheduleRecovery() {
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          RECOVERY_KEY,
          JSON.stringify({ name: this.file.name, doc: this.view.state.doc.toJSON(), at: Date.now() }),
        );
      } catch {
        /* quota or private mode */
      }
    }, 800);
  }

  private clearRecovery() {
    clearTimeout(this.recoveryTimer);
    try {
      localStorage.removeItem(RECOVERY_KEY);
    } catch {
      /* ignore */
    }
  }

  private loadRecovery(): PMNode | null {
    try {
      const raw = localStorage.getItem(RECOVERY_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const doc = PMNode.fromJSON(schema, data.doc);
      this.file = { name: data.name ?? this.file.name, target: null, dirty: true };
      queueMicrotask(() => this.status?.notice('Restored your unsaved work from last session.'));
      return doc;
    } catch {
      return null;
    }
  }

  private error(msg: string, err: unknown) {
    console.error(msg, err);
    openModal(msg, h('p', {}, String((err as Error)?.message ?? err)), [{ label: 'OK', primary: true }]);
  }

  // ---- Math helpers ------------------------------------------------------------------

  /** Math node that commands like "Edit LaTeX" act on. */
  private targetMath() {
    const mf = getActiveMathfield() ?? (this.qsTarget?.isConnected ? this.qsTarget : null);
    if (mf) {
      const found = cmd.mathNodeForField(this.view, mf);
      if (found) return found;
    }
    return cmd.selectedMath(this.view);
  }

  async editLatexSource() {
    const target = this.targetMath();
    const latex = await latexSourceDialog(target?.node.attrs.latex ?? '', target ? 'Edit LaTeX source' : 'Insert LaTeX');
    if (latex == null) return;
    if (target) {
      const node = this.view.state.doc.nodeAt(target.pos);
      if (node && node.type === target.node.type) {
        this.view.dispatch(this.view.state.tr.setNodeMarkup(target.pos, undefined, { ...node.attrs, latex }));
      }
      this.view.focus();
    } else if (latex.trim()) {
      const node = schema.nodes.math_inline.create({ latex });
      this.view.dispatch(this.view.state.tr.replaceSelectionWith(node, false).scrollIntoView());
      this.view.focus();
    }
  }

  private insertSnippet(m: Macro) {
    try {
      const slice = Slice.fromJSON(schema, m.slice as Parameters<typeof Slice.fromJSON>[1]);
      this.view.focus();
      this.view.dispatch(this.view.state.tr.replaceSelection(slice).scrollIntoView());
    } catch (err) {
      this.error('Could not insert snippet', err);
    }
  }

  private insertMacro(m: Macro, target: MathfieldElement | null) {
    if (m.kind === 'snippet') this.insertSnippet(m);
    else cmd.insertMath(this.view, m.latex ?? '', { target, raw: true });
  }

  private captureSelection() {
    const { state } = this.view;
    if (state.selection.empty) return null;
    const slice = state.selection.content();
    const preview = state.doc.textBetween(state.selection.from, state.selection.to, ' ', (n) => n.type.spec.leafText?.(n) ?? '').slice(0, 120);
    return { slice: slice.toJSON(), preview };
  }

  // ---- Quick search sources -------------------------------------------------------------

  private searchItems(): QSItem[] {
    const items: QSItem[] = [];
    const target = () => (this.qsTarget?.isConnected ? this.qsTarget : null);
    for (const e of MATH_CATALOG) {
      items.push({
        id: `math:${e.category}:${e.title}`,
        kind: 'math',
        title: e.title,
        subtitle: e.category,
        keywords: e.keywords,
        latex: applyNotation(e.latex),
        run: () => cmd.insertMath(this.view, e.latex, { target: target() }),
      });
    }
    for (const m of getMacros()) {
      items.push({
        id: `macro:${m.id}`,
        kind: 'macro',
        title: m.name,
        subtitle: m.kind === 'snippet' ? 'snippet' : m.trigger ? `type “${m.trigger}” in math` : undefined,
        keywords: `${m.trigger ?? ''} macro ${m.preview ?? ''}`,
        latex: m.kind === 'math' ? m.latex : undefined,
        run: () => this.insertMacro(m, target()),
      });
    }
    for (const c of allCommands()) {
      if (c.hidden || (c.enabled && !c.enabled())) continue;
      items.push({
        id: `cmd:${c.id}`,
        kind: c.category === 'File' && c.id.startsWith('recent:') ? 'file' : 'command',
        title: c.title,
        subtitle: c.category,
        keywords: c.keywords,
        shortcut: shortcutLabel(c.shortcut),
        run: () => {
          this.restoreFocus();
          runCommand(c.id);
        },
      });
    }
    if (native) {
      for (const p of this.recentFiles) {
        const name = p.split(/[\\/]/).pop() ?? p;
        items.push({ id: `file:${p}`, kind: 'file', title: name, subtitle: p, keywords: 'open recent file', run: () => void this.openPath(p) });
      }
    }
    return items;
  }

  private dynamicItems(raw: string): QSItem[] {
    const q = raw.trim();
    if (!q) return [];
    const looksLikeLatex = /^[\\=]/.test(q) || /[\^_{}]/.test(q);
    if (!looksLikeLatex) return [];
    const latex = q.replace(/^=\s*/, '');
    const target = this.qsTarget?.isConnected ? this.qsTarget : null;
    return [
      {
        id: 'latex:insert',
        kind: 'latex',
        title: target ? 'Insert into equation' : 'Insert as equation',
        keywords: latex,
        latex,
        run: () => cmd.insertMath(this.view, latex, { target, raw: true }),
      },
      {
        id: 'latex:macro',
        kind: 'latex',
        title: 'Save as macro…',
        latex,
        run: () => void editMacroDialog({ kind: 'math', latex }),
      },
    ];
  }

  // ---- Commands ---------------------------------------------------------------------------

  private registerMacroCommands() {
    // Macros appear in quick search directly; nothing to register, but refresh the ribbon.
    this.ribbon?.update();
  }

  private registerCommands() {
    const s = () => this.view.state;
    const mark = (name: string) => () => cmd.markActive(s(), schema.marks[name]);
    register(
      // File
      { id: 'file-new', title: 'New document', category: 'File', shortcut: isDesktop ? 'Mod-n' : 'Mod-Alt-n', global: true, keywords: 'create blank', run: () => this.newDoc() },
      { id: 'file-open', title: 'Open…', category: 'File', shortcut: 'Mod-o', global: true, keywords: 'load file import', run: () => this.open() },
      { id: 'file-save', title: 'Save', category: 'File', shortcut: 'Mod-s', global: true, run: () => void this.save() },
      { id: 'file-save-as', title: 'Save as…', category: 'File', shortcut: 'Mod-Shift-s', global: true, keywords: 'save copy', run: () => void this.saveAs() },
      // Export
      { id: 'export-docx', title: 'Export as Word (.docx)', category: 'Export', keywords: 'docx word microsoft office download', run: () => this.exportAs('docx') },
      { id: 'export-pdf', title: 'Export as PDF', category: 'Export', shortcut: 'Mod-p', global: true, keywords: 'print pdf', run: () => this.exportPdf() },
      { id: 'export-latex', title: 'Export as LaTeX (.tex)', category: 'Export', keywords: 'tex overleaf', run: () => this.exportAs('latex') },
      { id: 'export-html', title: 'Export as web page (.html)', category: 'Export', keywords: 'html mathml', run: () => this.exportAs('html') },
      // Edit
      { id: 'edit-undo', title: 'Undo', category: 'Edit', hidden: false, run: () => this.exec(undo) },
      { id: 'edit-redo', title: 'Redo', category: 'Edit', run: () => this.exec(redo) },
      { id: 'edit-select-all', title: 'Select all', category: 'Edit', run: () => this.exec(selectAll) },
      // Styles
      { id: 'style-normal', title: 'Normal text', category: 'Style', shortcut: 'Mod-Alt-0', keywords: 'paragraph body plain', run: () => this.exec(cmd.setParagraph), active: () => cmd.blockActive(s(), schema.nodes.paragraph) },
      ...[1, 2, 3, 4].map((n) => ({
        id: `style-h${n}`,
        title: `Heading ${n}`,
        category: 'Style' as const,
        shortcut: `Mod-Alt-${n}`,
        keywords: `title header h${n}`,
        run: () => this.exec(cmd.setHeading(n)),
        active: () => cmd.blockActive(s(), schema.nodes.heading, { level: n }),
      })),
      { id: 'style-code', title: 'Code block', category: 'Style', keywords: 'monospace pre', run: () => this.exec(cmd.setCodeBlock), active: () => cmd.blockActive(s(), schema.nodes.code_block) },
      // Format
      { id: 'fmt-bold', title: 'Bold', category: 'Format', shortcut: 'Mod-b', keywords: 'strong', run: () => this.exec(cmd.toggleBold), active: mark('strong') },
      { id: 'fmt-italic', title: 'Italic', category: 'Format', shortcut: 'Mod-i', keywords: 'emphasis', run: () => this.exec(cmd.toggleItalic), active: mark('em') },
      { id: 'fmt-underline', title: 'Underline', category: 'Format', shortcut: 'Mod-u', run: () => this.exec(cmd.toggleUnderline), active: mark('underline') },
      { id: 'fmt-strike', title: 'Strikethrough', category: 'Format', shortcut: 'Mod-Shift-x', keywords: 'cross out', run: () => this.exec(cmd.toggleStrike), active: mark('strike') },
      { id: 'fmt-sup', title: 'Superscript (text)', category: 'Format', shortcut: 'Mod-.', run: () => this.exec(cmd.toggleSup), active: mark('superscript') },
      { id: 'fmt-sub', title: 'Subscript (text)', category: 'Format', shortcut: 'Mod-,', run: () => this.exec(cmd.toggleSub), active: mark('subscript') },
      { id: 'fmt-code', title: 'Inline code', category: 'Format', shortcut: 'Mod-e', keywords: 'monospace', run: () => this.exec(cmd.toggleCode), active: mark('code') },
      { id: 'fmt-clear', title: 'Clear formatting', category: 'Format', shortcut: 'Mod-\\', keywords: 'remove plain reset', run: () => this.exec(cmd.clearFormatting) },
      { id: 'fmt-highlight-off', title: 'Remove highlight', category: 'Format', run: () => this.exec(cmd.setHighlight(null)) },
      ...(
        [
          ['yellow', '#fff176'], ['green', '#a5d6a7'], ['blue', '#80deea'], ['pink', '#f48fb1'], ['orange', '#ffcc80'], ['purple', '#ce93d8'],
        ] as const
      ).map(([name, color]) => ({
        id: `fmt-highlight-${name}`,
        title: `Highlight ${name}`,
        category: 'Format' as const,
        keywords: 'marker color background',
        run: () => this.exec(cmd.setHighlight(color)),
      })),
      ...(
        [
          ['black', '#000000'], ['red', '#c62828'], ['blue', '#1565c0'], ['green', '#2e7d32'], ['purple', '#6a1b9a'], ['orange', '#ef6c00'], ['gray', '#757575'],
        ] as const
      ).map(([name, color]) => ({
        id: `fmt-color-${name}`,
        title: `Text color ${name}`,
        category: 'Format' as const,
        keywords: 'font colour',
        run: () => this.exec(cmd.setTextColor(color)),
      })),
      // Paragraph
      { id: 'list-bullet', title: 'Bulleted list', category: 'Format', shortcut: 'Mod-Shift-8', keywords: 'bullets unordered ul', run: () => this.exec(cmd.toggleBulletList), active: () => !!cmd.inAncestor(s(), schema.nodes.bullet_list) },
      { id: 'list-ordered', title: 'Numbered list', category: 'Format', shortcut: 'Mod-Shift-7', keywords: 'ordered ol enumerate 1. 2. 3.', run: () => this.exec(cmd.toggleOrderedList), active: () => cmd.orderedListStyle(s()) === 'decimal' },
      { id: 'list-lettered', title: 'Lettered list (a. b. c.)', category: 'Format', shortcut: 'Mod-Shift-9', keywords: 'alphabetical letters ordered abc enumerate parts', run: () => this.exec(cmd.toggleLetteredList), active: () => cmd.orderedListStyle(s()) === 'lower-alpha' },
      { id: 'block-quote', title: 'Quote', category: 'Format', shortcut: 'Mod-Shift-q', keywords: 'blockquote indent', run: () => this.exec(cmd.toggleBlockquote), active: () => !!cmd.inAncestor(s(), schema.nodes.blockquote) },
      { id: 'insert-hr', title: 'Horizontal line', category: 'Insert', keywords: 'rule divider separator', run: () => this.exec(cmd.insertHorizontalRule) },
      ...(['left', 'center', 'right', 'justify'] as const).map((a) => ({
        id: `align-${a}`,
        title: `Align ${a}`,
        category: 'Format' as const,
        shortcut: `Mod-Shift-${{ left: 'l', center: 'e', right: 'r', justify: 'j' }[a]}`,
        keywords: 'alignment paragraph',
        run: () => this.exec(cmd.setAlign(a)),
        active: () => cmd.currentAlign(s()) === a,
      })),
      // Math
      { id: 'math-inline', title: 'Insert inline equation', category: 'Math', shortcut: 'Mod-m', keywords: 'math formula latex equation new', run: () => cmd.insertMath(this.view, '', { intoActive: false }) },
      { id: 'math-display', title: 'Insert display equation', category: 'Math', shortcut: 'Mod-Shift-m', keywords: 'math block centered formula equation new', run: () => cmd.insertMath(this.view, '', { display: true, intoActive: false }) },
      { id: 'math-edit-source', title: 'Edit LaTeX source…', category: 'Math', shortcut: 'Mod-Alt-m', global: true, keywords: 'raw latex code tex paste insert', run: () => this.editLatexSource() },
      { id: 'math-toggle-number', title: 'Toggle equation number', category: 'Math', global: true, keywords: 'numbered label (1)', run: () => void cmd.toggleEquationNumber(this.view) },
      { id: 'math-toggle-display', title: 'Switch inline ⇄ display equation', category: 'Math', global: true, keywords: 'block centered convert', run: () => void cmd.toggleMathDisplay(this.view) },
      { id: 'math-keyboard', title: 'Show/hide math keyboard', category: 'Math', keywords: 'virtual on-screen keyboard touch', run: () => showVirtualKeyboard() },
      {
        id: 'math-matrix',
        title: 'Insert matrix…',
        category: 'Math',
        keywords: 'matrix array grid table determinant',
        run: async () => {
          const target = getActiveMathfield() ?? this.qsTarget;
          const latex = await matrixDialog();
          if (latex) cmd.insertMath(this.view, latex, { target: target?.isConnected ? target : null });
        },
      },
      // Environments
      ...(Object.keys(ENV_KINDS) as EnvKind[]).map((k) => ({
        id: `env-${k}`,
        title: `${ENV_KINDS[k].label} block`,
        category: 'Insert' as const,
        keywords: 'environment theorem amsthm box',
        run: () => this.exec(cmd.toggleEnv(k)),
        active: () => cmd.inAncestor(s(), schema.nodes.math_env)?.attrs.kind === k,
      })),
      // Macros
      {
        id: 'macro-manage',
        title: 'Manage macros…',
        category: 'Macro',
        keywords: 'shortcuts snippets custom',
        run: () =>
          macroManagerDialog({
            currentLatex: () => this.targetMath()?.node.attrs.latex ?? null,
            captureSelection: () => this.captureSelection(),
          }),
      },
      {
        id: 'macro-new',
        title: 'Create math macro…',
        category: 'Macro',
        keywords: 'new shortcut trigger define',
        run: () => void editMacroDialog({ kind: 'math', latex: this.targetMath()?.node.attrs.latex ?? '' }),
      },
      {
        id: 'macro-snippet',
        title: 'Create snippet from selection…',
        category: 'Macro',
        keywords: 'new macro save selection reuse template',
        run: () => {
          const cap = this.captureSelection();
          if (!cap) {
            this.status.notice('Select some text or equations first.');
            return;
          }
          void editMacroDialog({ kind: 'snippet', slice: cap.slice, preview: cap.preview });
        },
      },
      // View
      { id: 'quick-search', title: 'Quick search', category: 'View', shortcut: 'Mod-Space', global: true, hidden: true, run: () => this.quick.toggle() },
      { id: 'app-settings', title: 'Settings…', category: 'View', global: true, keywords: 'preferences options font default notation arcsin inverse trig multiplication differential spellcheck theme', run: () => settingsDialog({ convertInverseTrig: (st) => this.convertInverseTrig(st) }) },
      { id: 'view-theme', title: 'Toggle dark mode', category: 'View', keywords: 'theme night light dark', run: () => this.toggleTheme() },
      { id: 'view-zoom-in', title: 'Zoom in', category: 'View', shortcut: 'Mod-=', global: true, run: () => this.setZoom(this.zoom + 0.1) },
      { id: 'view-zoom-out', title: 'Zoom out', category: 'View', shortcut: 'Mod--', global: true, run: () => this.setZoom(this.zoom - 0.1) },
      { id: 'view-zoom-reset', title: 'Reset zoom', category: 'View', shortcut: 'Mod-0', global: true, run: () => this.setZoom(1) },
      // Help
      { id: 'help-shortcuts', title: 'Keyboard shortcuts & tips', category: 'Help', shortcut: 'F1', global: true, keywords: 'help keys cheat sheet', run: () => shortcutsDialog() },
      {
        id: 'help-welcome',
        title: 'Open the welcome / tutorial document',
        category: 'Help',
        keywords: 'tutorial guide intro example',
        run: async () => {
          if (!(await this.confirmDiscard())) return;
          this.loadDoc(PMNode.fromJSON(schema, WELCOME_DOC), 'Welcome.mathdoc', null);
        },
      },
    );
  }
}
