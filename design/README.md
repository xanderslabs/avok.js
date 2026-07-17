# @avokjs/design

Single source of truth for Avok's visual identity: design tokens, CSP-safe CSS
generators, and inline Lucide icons. Precision-minimal / trust-tech — near
monochrome, one accent, nothing decorative.

The security ceremony popups are the hardest-working surface, so every choice
optimizes for legibility and trust there first.

## Three consumption paths

1. **Typed token object** — `palette` (light + dark `Scheme`), `radius`, `space`,
   `font`, `type`. Platform-neutral JS values. App **facades** (react /
   react-native / vanilla) import these directly; React Native needs JS style
   objects, not CSS, so the JS object is authoritative and everything else
   derives from it.

2. **`tokensCss()` + `primitivesCss()`** — CSS strings the origin **popups**
   concatenate into their inline `<style>`. `tokensCss()` emits `:root { --… }`
   (light) plus an `@media (prefers-color-scheme: dark)` override; `primitivesCss()`
   emits the shared `.avok-*` chrome. No external load of any kind, so they satisfy
   the popups' locked CSP.

3. **Docs values** — Mintlify `docs.json` uses `palette.light.accent` /
   `palette.dark.accent` for its theme colors and `font.sans` for its typeface.
   Mintlify config is static JSON, so these are hand-synced, but they are derived
   from this package — not independently invented.

## Usage — a popup renderer

```ts
import { tokensCss, primitivesCss, renderIcon } from "@avokjs/design";

export function renderSomePage(): string {
  return `<!DOCTYPE html><html><head><style>
${tokensCss()}
${primitivesCss()}
  </style></head>
  <body class="avok-body">
    <div class="avok-pop">
      <div class="avok-pop-h">
        ${renderIcon("shield-check")}
        <span class="avok-wm">Avok</span>
      </div>
      <div class="avok-pop-b"> … </div>
    </div>
  </body></html>`;
}
```

## Rules

- **Hybrid fonts.** `tokensCss()` emits the **system** font stack — popups are
  CSP-locked and cannot load a webfont, and a native stack reads as "the OS" on a
  key-reveal screen. The Geist brand stack lives in `font.sans` / `font.mono` for
  facades and docs, which self-host it.
- **Never load external assets in a popup.** No CDN, no `@import`, no remote
  `src`/`href`. Icons are inlined SVG via `renderIcon()`, not the `lucide` npm
  package. This package has zero runtime dependencies — keep it that way.
- **One icon language:** Lucide, everywhere.
- **Brand mark:** the favicon is a theme-aware node/diamond (`faviconSvg()` /
  `faviconLinkTag()`), not the wordmark. Popups inline it as a `data:` URI;
  `docs-site/favicon.svg` is generated from `faviconSvg()`. Header icons are tinted
  `--color-text`, matching the wordmark — accent stays for links + focus only.

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
