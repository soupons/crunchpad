/**
 * The crunchpad logo: an uppercase Ξ (xi) on the accent colour. Drawn as three
 * serifed bars rather than a font glyph so it looks identical everywhere. It is
 * rasterized to electron/icon.png by scripts/make-icon.cjs. The browser tab icon,
 * public/favicon.svg, is the same Ξ in blue on a transparent background.
 */
export const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true">' +
  '<rect width="512" height="512" rx="112" fill="#3b5bdb"/>' +
  '<g fill="#fff"><rect x="124" y="116" width="264" height="48" rx="8"/><rect x="124" y="116" width="24" height="76" rx="8"/><rect x="364" y="116" width="24" height="76" rx="8"/><rect x="172" y="232" width="168" height="48" rx="8"/><rect x="172" y="216" width="22" height="80" rx="8"/><rect x="318" y="216" width="22" height="80" rx="8"/><rect x="124" y="348" width="264" height="48" rx="8"/><rect x="124" y="320" width="24" height="76" rx="8"/><rect x="364" y="320" width="24" height="76" rx="8"/></g></svg>';
