/**
 * Central command registry. The ribbon, the quick search bar, and keyboard
 * shortcuts all run the same commands, so anything added here shows up everywhere.
 */
export type CommandCategory =
  | 'File'
  | 'Edit'
  | 'Style'
  | 'Format'
  | 'Insert'
  | 'Math'
  | 'Macro'
  | 'View'
  | 'Export'
  | 'Help';

export interface AppCommand {
  id: string;
  title: string;
  category: CommandCategory;
  keywords?: string;
  /** e.g. "Mod-Shift-m". Mod = Ctrl on Windows/Linux, Cmd on macOS. */
  shortcut?: string;
  /** Run even while typing inside a mathfield (save, open, quick search…). */
  global?: boolean;
  /** Hide from quick search (e.g. internal helpers). */
  hidden?: boolean;
  run: () => void | Promise<void>;
  active?: () => boolean;
  enabled?: () => boolean;
}

const commands = new Map<string, AppCommand>();

export function register(...cmds: AppCommand[]) {
  for (const c of cmds) commands.set(c.id, c);
}

export function unregisterPrefix(prefix: string) {
  for (const id of [...commands.keys()]) if (id.startsWith(prefix)) commands.delete(id);
}

export function getCommand(id: string) {
  return commands.get(id);
}

export function allCommands(): AppCommand[] {
  return [...commands.values()];
}

export function runCommand(id: string) {
  const c = commands.get(id);
  if (!c) {
    console.warn('Unknown command', id);
    return;
  }
  if (c.enabled && !c.enabled()) return;
  void c.run();
}

// ---- Shortcuts --------------------------------------------------------------

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

interface Combo {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

function parseShortcut(s: string): Combo {
  const parts = s.split('-');
  let key = parts.pop()!;
  if (key === '' ) key = '-';
  const set = new Set(parts.map((p) => p.toLowerCase()));
  return { key: key.toLowerCase(), mod: set.has('mod'), shift: set.has('shift'), alt: set.has('alt') };
}

const KEY_ALIASES: Record<string, string> = { ' ': 'space', spacebar: 'space' };

function eventKey(e: KeyboardEvent): string {
  let k = e.key.toLowerCase();
  k = KEY_ALIASES[k] ?? k;
  // With Shift/Alt held, e.key may be a symbol; fall back to the physical key.
  if (e.code.startsWith('Key')) k = e.code.slice(3).toLowerCase();
  else if (e.code.startsWith('Digit')) k = e.code.slice(5);
  else if (e.code === 'Space') k = 'space';
  else if (e.code === 'Period') k = '.';
  else if (e.code === 'Comma') k = ',';
  else if (e.code === 'Equal') k = '=';
  else if (e.code === 'Minus') k = '-';
  else if (e.code === 'Backslash') k = '\\';
  else if (e.code === 'Slash') k = '/';
  return k;
}

export function matches(e: KeyboardEvent, shortcut: string): boolean {
  const c = parseShortcut(shortcut);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  // Ctrl-Space should work on macOS too (Cmd-Space is Spotlight).
  if (c.key === 'space' && c.mod && !c.shift && !c.alt && e.ctrlKey && eventKey(e) === 'space') return true;
  return eventKey(e) === c.key && mod === c.mod && e.shiftKey === c.shift && e.altKey === c.alt;
}

export function shortcutLabel(shortcut?: string): string {
  if (!shortcut) return '';
  return shortcut
    .split('-')
    .map((p) => {
      switch (p.toLowerCase()) {
        case 'mod':
          return isMac ? '⌘' : 'Ctrl';
        case 'shift':
          return isMac ? '⇧' : 'Shift';
        case 'alt':
          return isMac ? '⌥' : 'Alt';
        case 'space':
          return 'Space';
        default:
          return p.length === 1 ? p.toUpperCase() : p;
      }
    })
    .join(isMac ? '' : '+');
}

/**
 * Window-level shortcut handler. Runs in the capture phase so shortcuts work
 * everywhere; while a mathfield has focus only `global` commands fire, so the
 * mathfield keeps its own keys (e.g. Ctrl+B for bold math is left to MathLive).
 */
export function installShortcutHandler(isInMathfield: () => boolean, isOverlayOpen: () => boolean) {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) return;
      const inMath = isInMathfield();
      const overlay = isOverlayOpen();
      for (const c of commands.values()) {
        if (!c.shortcut || !matches(e, c.shortcut)) continue;
        if (inMath && !c.global) continue;
        if (overlay && !c.global) continue;
        e.preventDefault();
        e.stopPropagation();
        runCommand(c.id);
        return;
      }
    },
    { capture: true },
  );
}
