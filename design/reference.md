# Avok design — reconstruction reference

The token **values** and rules live in [README.md](./README.md); the primitive **specs** in
[components.md](./components.md). This file carries the parts that were *code* in the deleted
`@avokjs/design` package — the CSS-variable names, the shared popup stylesheet, the inline icon SVGs,
and the favicon — verbatim, so the whole system can be rebuilt from `design/` alone (no git archaeology).

Nothing here is built or shipped; it is reference. When something needs Avok's chrome again (a new popup,
a docs theme), copy from here and swap the token values from README.md as needed.

## CSS custom properties

Colors are theme-aware (light in `:root`, dark under `@media (prefers-color-scheme: dark)`); the rest are
mode-independent. Names (kebab-case), paired with the README token keys:

| token key | CSS var | | token key | CSS var |
|---|---|---|---|---|
| `bg` | `--color-bg` | | `ink` | `--color-ink` |
| `bg2` | `--color-bg-2` | | `inkText` | `--color-ink-text` |
| `border` | `--color-border` | | `accent` | `--color-accent` |
| `text` | `--color-text` | | `success` | `--color-success` |
| `text2` | `--color-text-2` | | `danger` | `--color-danger` |
| `text3` | `--color-text-3` | | `onDanger` | `--color-on-danger` |
| | | | `caution` | `--color-caution` |

Non-color (emitted once in light `:root`): `--radius-outer|card|button|input` (12/9/8/8 px),
`--space-xs|sm|md|lg|xl` (4/8/12/16/24 px), `--font-sans` / `--font-mono` (system stacks — a CSP-locked
popup cannot load a webfont; the Geist brand stack is for facades/docs only).

`tokensCss()` shape (fill colors from README's palette tables):

```css
:root {
  --color-bg: #FFFFFF; /* …the 13 light colors… */
  --radius-outer: 12px; /* …radii, spacing… */
  --font-sans: <system sans stack>;
  --font-mono: <system mono stack>;
}
@media (prefers-color-scheme: dark) {
  :root { --color-bg: #18181B; /* …the 13 dark colors… */ }
}
```

## Shared popup primitives (`primitivesCss()`)

Authored once against the custom properties above — no hardcoded hex, no external load. This is the
canonical chrome for the ceremony popups.

```css
.avok-body { margin: 0; background: var(--color-bg); color: var(--color-text); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; display: flex; justify-content: center; padding: var(--space-lg); }
.avok-pop { width: 100%; max-width: 420px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-outer); overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06); }
.avok-pop-h { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--color-border); }
.avok-ic { color: var(--color-text); width: 16px; height: 16px; flex: none; }
.avok-wm { font-weight: 700; letter-spacing: -0.02em; font-size: 14px; color: var(--color-text); }
.avok-ctx { margin-left: auto; font-size: 11px; color: var(--color-text-3); word-break: break-all; text-align: right; }
.avok-pop-b { padding: var(--space-lg); }
.avok-ttl { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-text); margin: 0 0 var(--space-md); }
.avok-body-text { font-size: 14px; line-height: 1.55; color: var(--color-text-2); margin: 0 0 var(--space-md); }
.avok-card { background: var(--color-bg-2); border: 1px solid var(--color-border); border-radius: var(--radius-card); padding: var(--space-md); display: flex; flex-direction: column; gap: 9px; margin-bottom: var(--space-md); white-space: pre-wrap; word-break: break-word; font-size: 13px; color: var(--color-text); }
.avok-kv { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-md); }
.avok-k { font-size: 12px; color: var(--color-text-3); }
.avok-v { font-size: 13px; color: var(--color-text); font-weight: 500; }
.avok-v--mono { font-family: var(--font-mono); font-weight: 400; }
.avok-amt { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-text); font-family: var(--font-mono); }
.avok-divider { height: 1px; background: var(--color-border); }
.avok-acts { display: flex; gap: 9px; }
.avok-btn { flex: 1; padding: 10px 14px; border-radius: var(--radius-button); font-size: 13px; font-weight: 600; font-family: inherit; border: 1px solid transparent; cursor: pointer; text-align: center; }
.avok-btn:disabled { opacity: .55; cursor: default; }
.avok-btn--primary { background: var(--color-ink); color: var(--color-ink-text); }
.avok-btn--secondary { background: transparent; color: var(--color-text-2); border-color: var(--color-border); }
.avok-btn--danger { background: var(--color-danger); color: var(--color-on-danger); }
.avok-input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-input); background: var(--color-bg); color: var(--color-text); font-family: var(--font-mono); font-size: 13px; margin-bottom: var(--space-md); }
.avok-link { color: var(--color-accent); text-decoration: none; font-size: 12px; }
.avok-warning { background: color-mix(in srgb, var(--color-caution) 12%, transparent); border: 1px solid var(--color-caution); border-radius: var(--radius-card); padding: var(--space-md); font-size: 13px; line-height: 1.5; color: var(--color-text); margin-bottom: var(--space-md); }
.avok-status { margin-top: var(--space-md); font-size: 13px; color: var(--color-text-3); }
.avok-btn:focus-visible, .avok-input:focus-visible, .avok-link:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 1px; }
```

## Icons — inlined Lucide (ISC), never a CDN

`renderIcon(name)` wraps the inner path in a fixed `<svg viewBox="0 0 24 24" fill="none"
stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` (class
`avok-ic`, `size`/`class` escaped). The inner markup per icon:

- **shield-check** — `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>`
- **key-round** — `<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>`
- **triangle-alert** — `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>`
- **download** — `<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>`
- **archive** — `<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>`
- **smartphone** — `<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>`

## Favicon — the node/diamond mark (theme-aware, inline data-URI)

Pure geometry, ownable, crisp at favicon size; tile + glyph invert with `prefers-color-scheme`.
`INK = #18181B` (light ink), `PAPER = #FAFAFA` (dark text).

```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <style>.tile{fill:#18181B}.glyph{fill:#FAFAFA}
    @media (prefers-color-scheme: dark){.tile{fill:#FAFAFA}.glyph{fill:#18181B}}</style>
  <rect class="tile" width="24" height="24" rx="5.5"/>
  <rect class="glyph" x="7" y="7" width="10" height="10" rx="2.6" transform="rotate(45 12 12)"/>
</svg>
```

Inline it as `data:image/svg+xml,${encodeURIComponent(<svg…>)}` in a `<link rel="icon"
type="image/svg+xml">` — the only URL is the SVG XML namespace, so it satisfies the popup CSP.
