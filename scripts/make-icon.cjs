// Rasterizes the app logo (LOGO_SVG in src/app/logo.ts: white Ξ on a blue
// rounded square) to electron/icon.png (512×512), used as the desktop window icon
// and by electron-builder for installers. The browser favicon (public/favicon.svg)
// is a separate, transparent version.
// Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const logoTs = fs.readFileSync(path.join(root, 'src', 'app', 'logo.ts'), 'utf8');
const svg = [...logoTs.matchAll(/'([^']*)'/g)].map((m) => m[1]).join('').replace(' aria-hidden="true"', '');
const SIZE = 512;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setZoomFactor(1);
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${SIZE}" height="${SIZE}" `)}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const out = path.join(root, 'electron', 'icon.png');
  fs.writeFileSync(out, img.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log(`Wrote ${out} (${img.getSize().width}x${img.getSize().height} captured)`);
  app.quit();
});
