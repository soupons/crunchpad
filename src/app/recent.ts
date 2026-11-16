/**
 * Recently opened/saved documents, shown on the home page and in quick search.
 *
 * Desktop entries are file paths (mirrored to the main process so the File ▸ Open
 * Recent menu stays in sync). In the browser, an entry is a File System Access
 * handle kept in IndexedDB, which lets us reopen the file later after the user
 * grants permission again. Browsers without that API can't reopen files, so
 * nothing is recorded there.
 */
import { native } from './platform';

export interface RecentDoc {
  id: string;
  name: string;
  /** Desktop: absolute path. */
  path?: string;
  /** Last opened or saved (ms since epoch); 0 if unknown. */
  at: number;
}

const KEY = 'crunchpad:recent-docs';
const MAX = 12;
const listeners = new Set<() => void>();

export const canReopenFiles = () => !!native || typeof window.showOpenFilePicker === 'function';

function read(): RecentDoc[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(data) ? data.filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: RecentDoc[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn());
}

export function recentDocs(): RecentDoc[] {
  return read();
}

export function onRecentChanged(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Desktop: bring in the main process's list the first time (it predates this store). */
export async function seedFromNative() {
  if (!native || read().length) return;
  const paths = await native.getRecent();
  if (paths.length) write(paths.map((p) => ({ id: `path:${p}`, name: baseName(p), path: p, at: 0 })));
}

export function addRecentPath(path: string) {
  const id = `path:${path}`;
  write([{ id, name: baseName(path), path, at: Date.now() }, ...read().filter((d) => d.id !== id)]);
  native?.addRecent(path);
}

export async function addRecentHandle(handle: FileSystemFileHandle) {
  const list = read();
  // The same file picked twice gives two different handle objects; find the old entry.
  let id: string | null = null;
  for (const d of list) {
    if (d.path) continue;
    const old = await getHandle(d.id);
    if (old && (await old.isSameEntry(handle).catch(() => false))) {
      id = d.id;
      break;
    }
  }
  id ??= `handle:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await putHandle(id, handle);
  const next = [{ id, name: handle.name, at: Date.now() }, ...list.filter((d) => d.id !== id)];
  for (const d of next.slice(MAX)) if (!d.path) void deleteHandle(d.id);
  write(next);
}

export function removeRecent(id: string) {
  const doc = read().find((d) => d.id === id);
  write(read().filter((d) => d.id !== id));
  if (doc?.path) native?.removeRecent(doc.path);
  else void deleteHandle(id);
}

// ---- IndexedDB storage for file handles ---------------------------------------------

const DB = 'crunchpad';
const STORE = 'file-handles';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => d.close());
}

export async function getHandle(id: string): Promise<FileSystemFileHandle | null> {
  try {
    return (await tx('readonly', (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

async function putHandle(id: string, handle: FileSystemFileHandle) {
  await tx('readwrite', (s) => s.put(handle, id));
}

async function deleteHandle(id: string) {
  await tx('readwrite', (s) => s.delete(id)).catch(() => {});
}

/** Ask the browser for access to a stored handle again. Must run during a click. */
export async function ensurePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as FileSystemFileHandle & {
    queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
  };
  const opts = { mode: 'readwrite' };
  if (!h.queryPermission || (await h.queryPermission(opts)) === 'granted') return true;
  return (await h.requestPermission?.(opts)) === 'granted';
}
