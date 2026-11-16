import { native } from './platform';

/**
 * System clipboard access for the context menu. The desktop app goes through
 * Electron's clipboard (no permission prompts); the web app uses the async
 * Clipboard API, which may ask the user for permission to read.
 */

export interface ClipboardData {
  text?: string;
  html?: string;
  /** PNG image; may be a promise so the browser keeps the click's user activation while it renders. */
  png?: Blob | Promise<Blob>;
}

export async function writeClipboard(data: ClipboardData): Promise<void> {
  if (native?.clipboardWrite) {
    const png = data.png ? new Uint8Array(await (await data.png).arrayBuffer()) : undefined;
    await native.clipboardWrite({ text: data.text, html: data.html, png });
    return;
  }
  const items: Record<string, Blob | Promise<Blob>> = {};
  if (data.text != null) items['text/plain'] = new Blob([data.text], { type: 'text/plain' });
  if (data.html != null) items['text/html'] = new Blob([data.html], { type: 'text/html' });
  if (data.png) items['image/png'] = data.png;
  try {
    await navigator.clipboard.write([new ClipboardItem(items)]);
  } catch (err) {
    // Some browsers reject mixed items; plain text is the most important part.
    if (data.text != null && !data.png) await navigator.clipboard.writeText(data.text);
    else throw err;
  }
}

export async function readClipboard(): Promise<{ text: string; html: string }> {
  if (native?.clipboardRead) return native.clipboardRead();
  let text = '';
  let html = '';
  try {
    for (const item of await navigator.clipboard.read()) {
      if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
      if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
    }
  } catch {
    text = await navigator.clipboard.readText();
  }
  return { text, html };
}
