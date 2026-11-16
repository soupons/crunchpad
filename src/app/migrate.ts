/**
 * The app used to be called MathMirror and stored its data under `mathmirror:*`
 * keys. Copy anything not yet present under the new `crunchpad:*` keys. This
 * module is imported first in main.ts, before anything reads storage.
 */
try {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith('mathmirror:')) continue;
    const next = 'crunchpad:' + key.slice('mathmirror:'.length);
    if (localStorage.getItem(next) == null) localStorage.setItem(next, localStorage.getItem(key) ?? '');
  }
} catch {
  /* storage unavailable */
}

export {};
