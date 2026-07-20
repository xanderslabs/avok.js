# Avok landing page

A single static page for Avok. No build step and no dependencies. Open `index.html` directly, or
serve the folder with any static host.

## Deploy

Point any static host at this folder (`landing/`):

- **Vercel / Netlify:** set the project root or publish directory to `landing`.
- **GitHub Pages / Cloudflare Pages:** serve the folder as-is.
- **Local preview:** `npx serve landing` or open `index.html` in a browser.

## The live demo

The hero has a real "Create a wallet" demo. On click it dynamically imports the published
`@avokjs/core` from a CDN and runs the genuine passkey ceremony (`client.create()`), then shows the
actual EVM and Solana addresses the SDK derives. It is not a mock.

It activates when two things are true:

- **`@avokjs/core` is published to npm.** The demo imports it from `esm.sh`. `SDK_URL` in the demo
  script pins the version (currently `@avokjs/core@0.1.0`); bump it when core releases a new version.
- **The page is served over https or localhost.** WebAuthn requires a secure context. The demo
  degrades to an honest message anywhere it cannot run (an unpublished package, a blocked CDN, or an
  insecure or sandboxed context), so the page never breaks.

The passkey it creates is scoped to the page's own domain, so deploy the landing on the same origin
you want the demo wallet to belong to.

## Before it ships

Wire the placeholder links in `index.html`:

- **Docs** (`href="#docs"`) points to the documentation site once it has a URL.
- **npm** (`href="#npm"`) points to the package page once `@avokjs/*` is published.
- **GitHub** already points at `https://github.com/xanderslabs/avok.js`.
- **Demo version:** bump `SDK_URL` in the demo script to the published `@avokjs/core` version.
- **Social image:** `og.png` (1200x630) is referenced by absolute URL in the `<head>` meta. Update
  `https://avok.xyz` to your deployed domain so link unfurls resolve. `og.html` is the source you
  re-render it from if you change the copy.

## Design

Built on the tokens in [`../design/`](../design): Zinc warm-neutrals with a single Signal Ink accent
used only for links and focus. The brand typeface is Geist; self-host it and add an `@font-face`
declaration to pick it up. This page falls back to the system stack, and both light and dark themes
follow the viewer's `prefers-color-scheme`.

The favicon (`favicon.svg`) is the theme-aware node/diamond mark from the design reference.
