# Avok design reference

**A reference spec, not a package.** Avok's visual identity — tokens, the CSP-safe
styling rules for the popups, and the icon language. There is no `@avokjs/design`
package: it was a workspace package nothing imported (the popups always styled
themselves inline, the facades and examples carry their own token CSS, and the docs
hand-sync a few values). It was deleted in the package restructure; this doc is the
surviving source of truth for the values below.

Precision-minimal / trust-tech — near monochrome, one accent, nothing decorative. The
security ceremony popup is the hardest-working surface, so every choice optimizes for
legibility and trust there first.

## Where these values live now

- **The auth-popup** (`@avokjs/core/auth-popup`) styles its DOM **programmatically**
  (`view-dom.ts` sets `element.style.*`), so nothing external loads and the page stays
  hash-locked under its CSP. Match the tokens below when adjusting it.
- **Facades / examples** carry their own token CSS (see each example's
  `src/theme/tokens.css`) — self-contained so a clone needs no shared dependency.
- **Docs** (Mintlify `docs.json`) hand-sync `accent` + the sans typeface from the
  tables below.

## Rules

- **Never load external assets in a popup.** No CDN, no `@import`, no remote
  `src`/`href`. The auth-popup is CSP-locked (`default-src 'none'`,
  `connect-src 'none'`, hash-pinned inline script/style); any external reference is a
  wallet-drain regression. Icons are inlined SVG, never an icon-font or npm package.
- **System font on the popup.** A CSP-locked page cannot load a webfont, and a native
  stack reads as "the OS" on a key-reveal screen. The Geist brand stack is for facades
  and docs, which self-host it.
- **One icon language:** Lucide, everywhere.
- **Brand mark:** a theme-aware node/diamond, not the wordmark. Header icons are tinted
  `--color-text`; accent stays for links + focus only.

## Tokens

### Neutral — Zinc (warm-neutral)

| Token | Light | Dark |
|---|---|---|
| `bg` | `#FFFFFF` | `#18181B` |
| `bg2` | `#FAFAFA` | `#242427` |
| `border` | `#E4E4E7` | `#2E2E33` |
| `text` | `#18181B` | `#FAFAFA` |
| `text2` | `#3F3F46` | `#D4D4D8` |
| `text3` | `#71717A` | `#A1A1AA` |

### Accent — Signal Ink

| Token | Light | Dark | Role |
|---|---|---|---|
| `ink` / `inkText` | `#18181B` / `#FFFFFF` | `#FAFAFA` / `#18181B` | primary button |
| `accent` | `#2563EB` | `#7AA2FF` | links, focus ring |

### Semantic (reserved, separate from the brand hue)

| Token | Light | Dark | Role |
|---|---|---|---|
| `success` | `#16A34A` | `#4ADE80` | safe / approve |
| `danger` / `onDanger` | `#DC2626` / `#FFFFFF` | `#F87171` / `#FFFFFF` | reject / destructive |
| `caution` | `#D97706` | `#FBBF24` | caution banners |

### Scales

- Radius (px): `outer 12`, `card 9`, `button 8`, `input 8`.
- Spacing (px, 8px grid): `xs 4`, `sm 8`, `md 12`, `lg 16`, `xl 24`.
- Type: title 15/600, body 14/400, amount 20/600 mono, value 13 (mono for
  addresses/amounts/hashes), label 12, micro 10 uppercase.

See [components.md](./components.md) for the primitive component specs.
