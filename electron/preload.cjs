// Exposes a small, explicit file/menu API to the page as `window.mathmirrorNative`.
// The page never gets Node.js or arbitrary IPC access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mathmirrorNative', {
  openFile: (filters) => ipcRenderer.invoke('open-file', filters),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  saveFile: (path, data) => ipcRenderer.invoke('save-file', path, data),
  saveFileAs: (defaultName, data, filters) => ipcRenderer.invoke('save-file-as', defaultName, data, filters),
  exportPdf: (defaultName) => ipcRenderer.invoke('export-pdf', defaultName),
  setTitle: (title) => ipcRenderer.send('set-title', title),
  setDirty: (dirty) => ipcRenderer.send('set-dirty', dirty),
  getRecent: () => ipcRenderer.invoke('get-recent'),
  addRecent: (path) => ipcRenderer.send('add-recent', path),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, id) => cb(id)),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, p) => cb(p)),
});
