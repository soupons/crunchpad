import { convertLatexToMarkup } from 'mathlive';
import { cleanLatex } from './mathconv';

/**
 * Raster images of equations (and of SVG drawings), for "Copy as image" and
 * for embedding drawings in .docx files.
 */

const SCALE = 3; // render at 3x so pasted images stay crisp

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render image'));
    img.src = src;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG'))), 'image/png'),
  );
}

/** Rasterize an SVG document string (whose size is `width`×`height` CSS px) to PNG. */
export async function svgToPng(svg: string, width: number, height: number, scale = SCALE, background?: string): Promise<Blob> {
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d')!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasToPng(canvas);
}

// ---- Equations ----------------------------------------------------------------------

const fontCache = new Map<string, Promise<string>>();

function toDataUrl(url: string): Promise<string> {
  let p = fontCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.readAsDataURL(blob);
          }),
      )
      .catch(() => url);
    fontCache.set(url, p);
  }
  return p;
}

let mathCss: Promise<string> | null = null;

/**
 * MathLive's static-rendering CSS with its fonts inlined as data URLs: an SVG
 * drawn to a canvas can't load external resources.
 */
function collectMathCss(): Promise<string> {
  if (mathCss) return mathCss;
  mathCss = (async () => {
    const parts: Promise<string>[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet
      }
      const base = sheet.href ?? location.href;
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          if (!/KaTeX|ML__/i.test(rule.style.getPropertyValue('font-family'))) continue;
          const css = rule.cssText;
          const urls = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)];
          parts.push(
            Promise.all(urls.map((m) => toDataUrl(new URL(m[2], base).href))).then((data) => {
              let out = css;
              urls.forEach((m, i) => (out = out.replace(m[0], `url("${data[i]}")`)));
              return out;
            }),
          );
        } else if (rule.cssText.includes('ML__')) {
          parts.push(Promise.resolve(rule.cssText));
        }
      }
    }
    return (await Promise.all(parts)).join('\n');
  })();
  return mathCss;
}

/** Render an equation to a PNG on a white background. */
export async function latexToPng(latex: string, display = false): Promise<Blob> {
  const markup = convertLatexToMarkup(cleanLatex(latex) || '\\,', { defaultMode: display ? 'math' : 'inline-math' });
  const host = document.createElement('div');
  host.setAttribute(
    'style',
    `position:fixed;left:-10000px;top:0;display:inline-block;padding:${display ? '10px 14px' : '4px 6px'};` +
      `font-size:${display ? 26 : 22}px;color:#000;background:#fff;white-space:nowrap;line-height:normal`,
  );
  host.innerHTML = markup;
  document.body.appendChild(host);
  try {
    await document.fonts.ready;
    const { width, height } = host.getBoundingClientRect();
    const w = Math.ceil(width);
    const h = Math.ceil(height);
    const css = await collectMathCss();
    host.style.position = 'static';
    host.style.left = '0';
    host.style.transform = `scale(${SCALE})`;
    host.style.transformOrigin = '0 0';
    const xhtml = new XMLSerializer().serializeToString(host);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w * SCALE}" height="${h * SCALE}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml"><style>${css.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</style>${xhtml.replace(/^<div xmlns="[^"]*"/, '<div')}</div>` +
      `</foreignObject></svg>`;
    return await svgToPng(svg, w * SCALE, h * SCALE, 1, '#fff');
  } finally {
    host.remove();
  }
}
