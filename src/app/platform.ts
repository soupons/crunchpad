/**
 * File access that works in both the browser and the Electron desktop app.
 * The desktop preload script exposes `window.crunchpadNative`; in a browser we
 * use the File System Access API where available and fall back to
 * download/upload otherwise.
 */

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  name: string;
  /** Desktop: absolute path. Web: undefined. */
  path?: string;
  /** Web (File System Access API) handle for saving back in place. */
  handle?: FileSystemFileHandle;
  text: string;
}

export interface SaveTarget {
  name: string;
  path?: string;
  handle?: FileSystemFileHandle;
}

export interface NativeBridge {
  openFile(filters: FileFilter[]): Promise<{ path: string; name: string; text: string } | null>;
  readFile(path: string): Promise<{ path: string; name: string; text: string } | null>;
  saveFile(path: string, data: string | Uint8Array): Promise<void>;
  saveFileAs(
    defaultName: string,
    data: string | Uint8Array,
    filters: FileFilter[],
  ): Promise<{ path: string; name: string } | null>;
  exportPdf(defaultName: string): Promise<string | null>;
  setTitle(title: string): void;
  setDirty(dirty: boolean): void;
  clipboardWrite(data: { text?: string; html?: string; png?: Uint8Array }): Promise<void>;
  clipboardRead(): Promise<{ text: string; html: string }>;
  onMenu(cb: (commandId: string) => void): void;
  onOpenPath(cb: (path: string) => void): void;
  getRecent(): Promise<string[]>;
  addRecent(path: string): void;
}

declare global {
  interface Window {
    crunchpadNative?: NativeBridge;
    showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>;
  }
}

export const native: NativeBridge | undefined = window.crunchpadNative;
export const isDesktop = !!native;

const toPickerTypes = (filters: FileFilter[]) =>
  filters.map((f) => ({
    description: f.name,
    accept: { 'application/octet-stream': f.extensions.map((e) => '.' + e) },
  }));

export async function openFile(filters: FileFilter[]): Promise<OpenedFile | null> {
  if (native) {
    const f = await native.openFile(filters);
    return f ? { ...f } : null;
  }
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: toPickerTypes(filters), multiple: false });
      const file = await handle.getFile();
      return { name: file.name, handle, text: await file.text() };
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return null;
      throw err;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filters.flatMap((f) => f.extensions.map((e) => '.' + e)).join(',');
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, text: await file.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function download(name: string, data: string | Uint8Array, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Save to an existing target (in place). Returns false if it has no writable location. */
export async function saveTo(target: SaveTarget, data: string | Uint8Array): Promise<boolean> {
  if (native && target.path) {
    await native.saveFile(target.path, data);
    return true;
  }
  if (target.handle) {
    const w = await target.handle.createWritable();
    await w.write(data as FileSystemWriteChunkType);
    await w.close();
    return true;
  }
  return false;
}

/** Ask for a location and save. Returns the new target, or null if cancelled. */
export async function saveAs(
  defaultName: string,
  data: string | Uint8Array,
  filters: FileFilter[],
  mime = 'application/octet-stream',
): Promise<SaveTarget | null> {
  if (native) {
    const r = await native.saveFileAs(defaultName, data, filters);
    return r ? { name: r.name, path: r.path } : null;
  }
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: defaultName, types: toPickerTypes(filters) });
      const target = { name: handle.name, handle };
      await saveTo(target, data);
      return target;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return null;
      throw err;
    }
  }
  download(defaultName, data, mime);
  return { name: defaultName };
}
