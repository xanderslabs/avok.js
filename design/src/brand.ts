import { palette } from "./tokens.js";

// The Avok mark: a rounded diamond / node on a rounded Signal-Ink tile.
// Pure geometry — ownable, stays crisp at favicon size. Theme-aware: tile and
// glyph invert with prefers-color-scheme, so it stays legible on either a light
// or dark browser tab. Colors derive from the tokens.
const INK = palette.light.ink; // #18181B
const PAPER = palette.dark.text; // #FAFAFA

/**
 * The node/diamond favicon as a standalone, theme-aware SVG string.
 * Used verbatim for docs-site/favicon.svg and inlined (via faviconDataUri) in the
 * origin popups. No external load — the only URL is the SVG XML namespace.
 */
export function faviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<style>.tile{fill:${INK}}.glyph{fill:${PAPER}}` +
    `@media (prefers-color-scheme: dark){.tile{fill:${PAPER}}.glyph{fill:${INK}}}</style>` +
    `<rect class="tile" width="24" height="24" rx="5.5"/>` +
    `<rect class="glyph" x="7" y="7" width="10" height="10" rx="2.6" transform="rotate(45 12 12)"/>` +
    `</svg>`;
}

/** The favicon as an inline, URL-encoded data URI (platform-neutral, no Buffer/btoa). */
export function faviconDataUri(): string {
  return `data:image/svg+xml,${encodeURIComponent(faviconSvg())}`;
}

/** A ready-to-inline <link rel="icon"> tag for the popup <head>. */
export function faviconLinkTag(): string {
  return `<link rel="icon" type="image/svg+xml" href="${faviconDataUri()}">`;
}
