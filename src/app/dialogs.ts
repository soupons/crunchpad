import { convertLatexToMarkup } from 'mathlive';
import { h } from './dom';
import { allCommands, shortcutLabel, type AppCommand } from './registry';
import { deleteMacro, getMacros, newMacroId, onMacrosChanged, saveMacro, type Macro } from './macros';
import { previewLatex } from '../math/catalog';

let openCount = 0;
export const isDialogOpen = () => openCount > 0;

export interface ModalAction {
  label: string;
  primary?: boolean;
  danger?: boolean;
  /** Return false to keep the dialog open. */
  run?: () => boolean | void | Promise<boolean | void>;
}

export function openModal(title: string, body: HTMLElement, actions: ModalAction[] = [], opts: { wide?: boolean; onClose?: () => void } = {}) {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  openCount++;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openCount--;
    backdrop.remove();
    opts.onClose?.();
    previouslyFocused?.focus?.();
  };
  const footer = h(
    'div.modal-actions',
    {},
    actions.map((a) =>
      h(
        'button',
        {
          class: a.primary ? 'btn primary' : a.danger ? 'btn danger' : 'btn',
          onclick: async () => {
            const r = a.run ? await a.run() : undefined;
            if (r !== false) close();
          },
        },
        a.label,
      ),
    ),
  );
  const dialog = h(
    'div.modal',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, class: opts.wide ? 'modal wide' : 'modal' },
    h('div.modal-header', {}, h('h2', {}, title), h('button.icon-btn', { onclick: close, 'aria-label': 'Close', title: 'Close (Esc)' }, '✕')),
    h('div.modal-body', {}, body),
    actions.length ? footer : null,
  );
  const backdrop = h('div.modal-backdrop', {
    onmousedown: (e: Event) => {
      if (e.target === backdrop) close();
    },
  });
  backdrop.appendChild(dialog);
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const primary = footer.querySelector<HTMLButtonElement>('.primary');
      primary?.click();
    }
  });
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => {
    const first = dialog.querySelector<HTMLElement>('[autofocus], input, textarea, select, .modal-body button');
    (first ?? dialog.querySelector<HTMLElement>('button'))?.focus();
  });
  return close;
}

export function renderLatex(latex: string, display = false): string {
  try {
    return convertLatexToMarkup(previewLatex(latex), { defaultMode: display ? 'math' : 'inline-math' });
  } catch {
    return '<span class="latex-error">invalid LaTeX</span>';
  }
}

// ---- Edit LaTeX source -------------------------------------------------------

export function latexSourceDialog(initial: string, title = 'Edit LaTeX source'): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const preview = h('div.latex-preview');
    const area = h('textarea.latex-source', { spellcheck: false, rows: 6, autofocus: true }) as HTMLTextAreaElement;
    area.value = initial;
    const refresh = () => (preview.innerHTML = renderLatex(area.value, true));
    area.addEventListener('input', refresh);
    refresh();
    const body = h(
      'div.stack',
      {},
      h('p.hint', {}, 'Type or paste raw LaTeX. Ctrl+Enter to apply.'),
      area,
      h('div.label', {}, 'Preview'),
      preview,
    );
    openModal(
      title,
      body,
      [
        { label: 'Cancel' },
        { label: 'Apply', primary: true, run: () => void (result = area.value) },
      ],
      { onClose: () => resolve(result) },
    );
  });
}

// ---- Generic form prompt -------------------------------------------------------

export interface Field {
  key: string;
  label: string;
  value?: string;
  type?: 'text' | 'number' | 'select' | 'textarea';
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export function formDialog(title: string, fields: Field[], okLabel = 'OK'): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    let result: Record<string, string> | null = null;
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
    const body = h(
      'div.form',
      {},
      fields.map((f) => {
        let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        if (f.type === 'select') {
          input = h('select', {}, (f.options ?? []).map((o) => h('option', { value: o.value }, o.label)));
        } else if (f.type === 'textarea') {
          input = h('textarea', { rows: 4, placeholder: f.placeholder ?? '' });
        } else {
          input = h('input', { type: f.type ?? 'text', placeholder: f.placeholder ?? '' });
        }
        input.value = f.value ?? '';
        inputs.set(f.key, input);
        return h('label.field', {}, h('span', {}, f.label), input);
      }),
    );
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        (body.closest('.modal')?.querySelector('.primary') as HTMLButtonElement | null)?.click();
      }
    });
    openModal(
      title,
      body,
      [
        { label: 'Cancel' },
        {
          label: okLabel,
          primary: true,
          run: () => {
            result = Object.fromEntries([...inputs].map(([k, el]) => [k, el.value]));
          },
        },
      ],
      { onClose: () => resolve(result) },
    );
  });
}

// ---- Matrix builder --------------------------------------------------------------

export async function matrixDialog(): Promise<string | null> {
  const r = await formDialog(
    'Insert matrix',
    [
      { key: 'rows', label: 'Rows', value: '3', type: 'number' },
      { key: 'cols', label: 'Columns', value: '3', type: 'number' },
      {
        key: 'env',
        label: 'Brackets',
        type: 'select',
        value: 'pmatrix',
        options: [
          { value: 'pmatrix', label: '( ) parentheses' },
          { value: 'bmatrix', label: '[ ] brackets' },
          { value: 'vmatrix', label: '| | determinant' },
          { value: 'Bmatrix', label: '{ } braces' },
          { value: 'matrix', label: 'none' },
        ],
      },
    ],
    'Insert',
  );
  if (!r) return null;
  const rows = Math.max(1, Math.min(12, parseInt(r.rows) || 2));
  const cols = Math.max(1, Math.min(12, parseInt(r.cols) || 2));
  const row = Array(cols).fill('#?').join(' & ');
  return `\\begin{${r.env}}${Array(rows).fill(row).join('\\\\ ')}\\end{${r.env}}`;
}

// ---- Macro manager ----------------------------------------------------------------

export interface MacroDialogDeps {
  /** LaTeX of the equation being edited / selected, if any. */
  currentLatex: () => string | null;
  /** Capture the current document selection as a snippet. */
  captureSelection: () => { slice: unknown; preview: string } | null;
}

export async function editMacroDialog(existing: Partial<Macro> = {}): Promise<Macro | null> {
  const isSnippet = existing.kind === 'snippet';
  const fields: Field[] = [
    { key: 'name', label: 'Name (shown in quick search)', value: existing.name ?? '', placeholder: 'e.g. Gaussian integral' },
  ];
  if (!isSnippet) {
    fields.push(
      { key: 'trigger', label: 'Trigger typed inside equations (optional)', value: existing.trigger ?? '', placeholder: 'e.g. gauss' },
      { key: 'latex', label: 'LaTeX (#? = placeholder you can Tab to)', value: existing.latex ?? '', type: 'textarea', placeholder: '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx' },
    );
  }
  const r = await formDialog(existing.id ? 'Edit macro' : 'New macro', fields, 'Save');
  if (!r || !r.name.trim()) return null;
  const macro: Macro = {
    id: existing.id ?? newMacroId(),
    name: r.name.trim(),
    kind: isSnippet ? 'snippet' : 'math',
    trigger: r.trigger?.trim() || undefined,
    latex: isSnippet ? undefined : r.latex,
    slice: existing.slice,
    preview: existing.preview,
  };
  saveMacro(macro);
  return macro;
}

export function macroManagerDialog(deps: MacroDialogDeps) {
  const list = h('div.macro-list');
  const render = () => {
    list.replaceChildren();
    const macros = getMacros();
    if (!macros.length) list.append(h('p.hint', {}, 'No macros yet.'));
    for (const m of macros) {
      const preview =
        m.kind === 'math' ? h('span.macro-preview', { html: renderLatex(m.latex ?? '') }) : h('span.macro-preview.snippet', {}, m.preview ?? '');
      list.append(
        h(
          'div.macro-row',
          {},
          h('div.macro-meta', {}, h('strong', {}, m.name), m.trigger ? h('code', {}, m.trigger) : h('span.tag', {}, m.kind === 'snippet' ? 'snippet' : 'no trigger')),
          preview,
          h(
            'div.macro-row-actions',
            {},
            h('button.btn.small', { onclick: () => editMacroDialog(m) }, 'Edit'),
            h('button.btn.small.danger', { onclick: () => deleteMacro(m.id) }, 'Delete'),
          ),
        ),
      );
    }
  };
  const unsubscribe = onMacrosChanged(render);
  render();
  const body = h(
    'div.stack',
    {},
    h(
      'p.hint',
      {},
      'Math macros expand when you type their trigger inside an equation. Snippets save formatted text + equations from your selection. All macros are searchable with Ctrl+Space.',
    ),
    h(
      'div.row',
      {},
      h('button.btn', { onclick: () => editMacroDialog({ kind: 'math', latex: deps.currentLatex() ?? '' }) }, '+ Math macro'),
      h(
        'button.btn',
        {
          onclick: () => {
            const cap = deps.captureSelection();
            if (!cap) {
              alert('Select some text or equations in the document first.');
              return;
            }
            void editMacroDialog({ kind: 'snippet', slice: cap.slice, preview: cap.preview });
          },
        },
        '+ Snippet from selection',
      ),
    ),
    list,
  );
  openModal('Macros', body, [{ label: 'Done', primary: true }], { wide: true, onClose: () => void unsubscribe() });
}

// ---- Shortcut reference --------------------------------------------------------------

export function shortcutsDialog() {
  const groups = new Map<string, AppCommand[]>();
  for (const c of allCommands()) {
    if (!c.shortcut || c.hidden) continue;
    if (!groups.has(c.category)) groups.set(c.category, []);
    groups.get(c.category)!.push(c);
  }
  const typing: [string, string][] = [
    ['$x^2$', 'Inline equation'],
    ['$$ (empty line)', 'Display equation'],
    ['$$ (mid-line)', 'Empty inline equation'],
    ['\\frac␣  \\alpha␣  \\int␣', 'Start an equation with that command'],
    ['\\(  /  \\[', 'Inline / display equation'],
    ['# ## ### ####', 'Headings'],
    ['-  1.  >', 'Lists and quotes'],
  ];
  const inMath: [string, string][] = [
    ['/', 'Fraction (a/b → a over b)'],
    ['^  _', 'Superscript / subscript'],
    ['sqrt  int  sum  lim', 'Templates'],
    ['alpha  pi  theta …', 'Greek letters'],
    ['->  <=  !=  +-  oo', 'Arrows, relations, ±, ∞'],
    ['RR NN ZZ QQ CC', 'Number sets'],
    ['Tab', 'Next placeholder'],
    ['\\', 'Type a raw LaTeX command'],
    ['← → at the edges, Enter, Esc', 'Leave the equation'],
    ['Shift+Enter (display)', 'New line in equation'],
  ];
  const table = (rows: [string, string][]) =>
    h('table.kbd-table', {}, rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v))));
  const body = h(
    'div.shortcut-grid',
    {},
    h('section', {}, h('h3', {}, 'While typing text'), table(typing)),
    h('section', {}, h('h3', {}, 'Inside an equation'), table(inMath)),
    ...[...groups].map(([cat, cmds]) =>
      h('section', {}, h('h3', {}, cat), table(cmds.map((c) => [shortcutLabel(c.shortcut), c.title]))),
    ),
  );
  openModal('Keyboard shortcuts', body, [], { wide: true });
}
