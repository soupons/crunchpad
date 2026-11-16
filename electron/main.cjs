// MathMirror desktop shell (Windows / macOS / Linux).
// The editor itself is the same web app; this file adds native file dialogs,
// menus, PDF export and file associations.
const { app, BrowserWindow, ClipboardItem, Menu, clipboard, dialog, ipcMain, nativeImage, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEV_URL = process.env.MATHMIRROR_DEV_URL;
/** `MATHMIRROR_SMOKE_TEST=<out.pdf>`: load hidden, verify the app, print a PDF, quit. */
const SMOKE_TEST = process.env.MATHMIRROR_SMOKE_TEST;
const isMac = process.platform === 'darwin';

/** @type {BrowserWindow | null} */
let win = null;
let dirty = false;
let lastDir = app.getPath('documents');
let pendingOpenPath = findFileArg(process.argv);

function findFileArg(argv) {
  return argv.slice(1).find((a) => /\.(mathdoc|md|txt|tex)$/i.test(a) && !a.startsWith('-')) ?? null;
}

// ---- Recent files ---------------------------------------------------------
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
async function getRecent() {
  try {
    return JSON.parse(await fs.readFile(recentFile(), 'utf8'));
  } catch {
    return [];
  }
}
async function addRecent(p) {
  const list = [p, ...(await getRecent()).filter((x) => x !== p)].slice(0, 10);
  await fs.mkdir(path.dirname(recentFile()), { recursive: true });
  await fs.writeFile(recentFile(), JSON.stringify(list));
  app.addRecentDocument(p);
  buildMenu();
}

// ---- Window -----------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 480,
    title: 'MathMirror',
    backgroundColor: '#e9ebef',
    show: !SMOKE_TEST,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file:');
    if (!allowed) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  win.webContents.on('did-finish-load', () => {
    if (SMOKE_TEST) return void runSmokeTest();
    if (pendingOpenPath) {
      win.webContents.send('open-path', path.resolve(pendingOpenPath));
      pendingOpenPath = null;
    }
  });

  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Cancel', 'Close without saving'],
      defaultId: 0,
      cancelId: 0,
      message: 'You have unsaved changes.',
      detail: 'Your work is also kept as a recovery copy and will be restored next time you open MathMirror.',
    });
    if (choice === 0) e.preventDefault();
  });
  win.on('closed', () => {
    win = null;
  });
}

async function runSmokeTest() {
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const report = await win.webContents.executeJavaScript(`({
      bridge: typeof window.mathmirrorNative,
      ribbonButtons: document.querySelectorAll('#ribbon button').length,
      equations: document.querySelectorAll('math-field').length,
      title: document.title,
    })`);
    const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    await fs.writeFile(SMOKE_TEST, pdf);
    console.log('SMOKE OK', JSON.stringify(report), `pdf=${pdf.length} bytes`);
    app.exit(0);
  } catch (err) {
    console.error('SMOKE FAILED', err);
    app.exit(1);
  }
}

const send = (id) => win?.webContents.send('menu', id);

async function buildMenu() {
  const recent = await getRecent();
  // Accelerators are shown in the menu but handled by the page (registerAccelerator: false)
  // so shortcuts behave identically on web and desktop.
  const item = (label, id, accelerator) => ({ label, accelerator, registerAccelerator: false, click: () => send(id) });
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '&File',
      submenu: [
        item('New', 'file-new', 'CmdOrCtrl+N'),
        item('Open…', 'file-open', 'CmdOrCtrl+O'),
        {
          label: 'Open Recent',
          submenu: recent.length
            ? [
                ...recent.map((p) => ({ label: p, click: () => win?.webContents.send('open-path', p) })),
                { type: 'separator' },
                {
                  label: 'Clear Recent',
                  click: async () => {
                    await fs.writeFile(recentFile(), '[]').catch(() => {});
                    app.clearRecentDocuments();
                    buildMenu();
                  },
                },
              ]
            : [{ label: 'No recent files', enabled: false }],
        },
        { type: 'separator' },
        item('Save', 'file-save', 'CmdOrCtrl+S'),
        item('Save As…', 'file-save-as', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        {
          label: 'Export',
          submenu: [
            item('Word Document (.docx)…', 'export-docx'),
            item('PDF…', 'export-pdf', 'CmdOrCtrl+P'),
            item('LaTeX (.tex)…', 'export-latex'),
            item('Web Page (.html)…', 'export-html'),
          ],
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        item('Undo', 'edit-undo', 'CmdOrCtrl+Z'),
        item('Redo', 'edit-redo', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        item('Quick Search…', 'quick-search', 'Ctrl+Space'),
        item('Macros…', 'macro-manage'),
      ],
    },
    {
      label: '&Insert',
      submenu: [
        item('Inline Equation', 'math-inline', 'CmdOrCtrl+M'),
        item('Display Equation', 'math-display', 'CmdOrCtrl+Shift+M'),
        item('Edit LaTeX Source…', 'math-edit-source', 'CmdOrCtrl+Alt+M'),
        item('Matrix…', 'math-matrix'),
        { type: 'separator' },
        item('Theorem', 'env-theorem'),
        item('Definition', 'env-definition'),
        item('Proof', 'env-proof'),
      ],
    },
    {
      label: '&View',
      submenu: [
        item('Zoom In', 'view-zoom-in', 'CmdOrCtrl+='),
        item('Zoom Out', 'view-zoom-out', 'CmdOrCtrl+-'),
        item('Reset Zoom', 'view-zoom-reset', 'CmdOrCtrl+0'),
        item('Toggle Dark Mode', 'view-theme'),
        item('Settings…', 'app-settings'),
        item('Math Keyboard', 'math-keyboard'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Help',
      submenu: [item('Keyboard Shortcuts', 'help-shortcuts', 'F1'), item('Tutorial Document', 'help-welcome')],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC: file access -----------------------------------------------------------
const toDialogFilters = (filters) => [...(filters ?? []), { name: 'All files', extensions: ['*'] }];

async function readDoc(p) {
  const text = await fs.readFile(p, 'utf8');
  lastDir = path.dirname(p);
  return { path: p, name: path.basename(p), text };
}

ipcMain.handle('open-file', async (_e, filters) => {
  const r = await dialog.showOpenDialog(win, {
    defaultPath: lastDir,
    properties: ['openFile'],
    filters: toDialogFilters(filters),
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return readDoc(r.filePaths[0]);
});

ipcMain.handle('read-file', async (_e, p) => {
  try {
    return await readDoc(p);
  } catch {
    return null;
  }
});

ipcMain.handle('save-file', async (_e, p, data) => {
  await fs.writeFile(p, typeof data === 'string' ? data : Buffer.from(data));
});

ipcMain.handle('save-file-as', async (_e, defaultName, data, filters) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(lastDir, defaultName),
    filters: toDialogFilters(filters),
  });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
  lastDir = path.dirname(r.filePath);
  return { path: r.filePath, name: path.basename(r.filePath) };
});

ipcMain.handle('export-pdf', async (_e, defaultName) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(lastDir, defaultName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath || !win) return null;
  const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
  await fs.writeFile(r.filePath, pdf);
  lastDir = path.dirname(r.filePath);
  shell.openPath(r.filePath);
  return r.filePath;
});

// ---- Clipboard (context menu cut/copy/paste, copy as image) --------------------------
// Electron 45+ has a W3C-style async clipboard (ClipboardItem, MIME types);
// older versions have the synchronous text/html/image API.
const asyncClipboard = typeof ClipboardItem === 'function';

ipcMain.handle('clipboard-write', async (_e, data) => {
  const text = typeof data?.text === 'string' ? data.text : undefined;
  const html = typeof data?.html === 'string' ? data.html : undefined;
  const png = data?.png instanceof Uint8Array ? Buffer.from(data.png) : undefined;
  if (asyncClipboard) {
    const items = {};
    if (text !== undefined) items['text/plain'] = text;
    if (html !== undefined) items['text/html'] = html;
    if (png) items['image/png'] = new Blob([png], { type: 'image/png' });
    await clipboard.write([new ClipboardItem(items)]);
    return;
  }
  const out = {};
  if (text !== undefined) out.text = text;
  if (html !== undefined) out.html = html;
  if (png) out.image = nativeImage.createFromBuffer(png);
  clipboard.write(out);
});

ipcMain.handle('clipboard-read', async () => {
  if (!asyncClipboard) return { text: clipboard.readText(), html: clipboard.readHTML() };
  let text = '';
  let html = '';
  for (const item of await clipboard.read()) {
    if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
    if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
  }
  return { text, html };
});

ipcMain.handle('get-recent', () => getRecent());
ipcMain.on('add-recent', (_e, p) => void addRecent(p));
ipcMain.on('set-title', (_e, title) => win?.setTitle(title));
ipcMain.on('set-dirty', (_e, d) => {
  dirty = !!d;
  if (isMac) win?.setDocumentEdited(dirty);
});

// ---- App lifecycle ------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const p = findFileArg(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (p) win.webContents.send('open-path', path.resolve(p));
    }
  });

  // macOS: double-clicking a .mathdoc in Finder.
  app.on('open-file', (e, p) => {
    e.preventDefault();
    if (win) win.webContents.send('open-path', p);
    else pendingOpenPath = p;
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
