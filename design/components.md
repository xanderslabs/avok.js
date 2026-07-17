# Component specs

The shared popup primitives emitted by `primitivesCss()`. Every class references
token custom properties only, so all components are light/dark-aware for free via
`tokensCss()`. Cycle 2 demos consume the same vocabulary.

**Icon rule:** one icon language — Lucide inline SVG via `renderIcon(name)`, never
a CDN or the `lucide` npm package. Default 16px, `class="avok-ic"`, tinted
`--color-text` (monochrome, matching the wordmark — the accent is reserved for
links + focus only).

## Wordmark — `.avok-wm`

"Avok", weight 700, `letter-spacing: -0.02em`, `--color-text`. On popups it renders
in the system font (Geist off-popup). Always paired with the shield header. The
wordmark carries the name in-UI; it is **not** used as the favicon (illegible small).

## Brand mark / favicon — `faviconSvg()` / `faviconLinkTag()`

A rounded **node / diamond** on a rounded Signal-Ink tile — pure geometry, so it
stays crisp at 16px and is ownable (no borrowed meaning to outgrow). Theme-aware:
tile and glyph invert with `prefers-color-scheme`, so it stays legible on a light
or dark browser tab. Colors derive from the tokens (`palette.light.ink` /
`palette.dark.text`). Popups inline it via `faviconLinkTag()` (a `data:` URI — no
external file); `docs-site/favicon.svg` is generated verbatim from `faviconSvg()`.
Deliberately simple, so it can grow into a full logo later.

## Shield header — `.avok-pop-h`

The consistent ceremony chrome: `renderIcon(<icon>)` (tinted `--color-text`, so it
reads as one monochrome unit with the wordmark) + `.avok-wm` + an optional
right-aligned `.avok-ctx` context label (`--color-text-3`, e.g. the requesting
origin or the action name). Bottom border in `--color-border`.

Per-popup icon: sign → `shield-check`, export → `key-round`, import → `download`,
backup → `archive`, add-passkey → `smartphone`.

## Data-card — `.avok-card` / `.avok-kv` / `.avok-amt`

The canonical "here's what you're approving" block. `--color-bg-2` surface,
`--color-border`, `--radius-card`. Rows use `.avok-kv` (key `.avok-k` in
`--color-text-3`, value `.avok-v`; add `.avok-v--mono` for addresses/amounts/
hashes). The emphasized figure uses `.avok-amt` (20px, mono). Hairline
`.avok-divider` separates the headline amount from details.

## Button pair — `.avok-btn`

Equal-width, `--radius-button`. Variants:

- `.avok-btn--primary` — `--color-ink` fill / `--color-ink-text`. The affirmative
  action (Approve, Import, Prepare backup, Add device).
- `.avok-btn--secondary` — transparent, `--color-border`, `--color-text-2`. The
  dismissive action (Reject).
- `.avok-btn--danger` — `--color-danger` fill / `--color-on-danger`. Destructive
  reveal only (export's "Reveal private key").

**Convention:** in a confirm/deny pair, Reject sits **left**, the primary action
**right**. `:disabled` drops opacity to .55.

## Input — `.avok-input`

Full-width, `--radius-input`, mono font (secrets/addresses). Used for the import
textarea.

## Link + focus — `.avok-link`

`--color-accent`, no underline. All interactive elements
(`.avok-btn`, `.avok-input`, `.avok-link`) get a 2px `--color-accent`
`:focus-visible` ring with `outline-offset: 1px`.

## Warning banner — `.avok-warning`

Caution context (e.g. the export DANGER copy). `--color-caution` border over a 12%
`color-mix` tint of the same hue; text stays `--color-text` for legibility.
Reserved for genuine risk — not decoration.

## Status line — `.avok-status`

Muted `--color-text-3` line under the actions for transient state ("Waiting for
passkey…", errors, clipboard countdown).
