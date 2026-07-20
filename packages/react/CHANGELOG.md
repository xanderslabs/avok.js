# @avokjs/react

## 0.1.0

### Minor Changes

- 9419676: Package restructure — **BREAKING**: 11 packages → 3 published. The SDK is now one framework-agnostic
  core plus two thin framework facades, in the shape of a lean industry SDK (permissionless-style domain
  folders, not a private-package bundling dance).

  **New public package — `@avokjs/core`.** It _is_ the plain-JS/browser SDK (the old `@avokjs/vanilla`,
  collapsed in) and the framework-agnostic core. Subpaths: `/engine` (platform-agnostic, no browser
  globals — the React-Native base), `/wallet`, `/evm`, `/solana`, `/channel`, `/provider`, `/helpers`
  (name resolution + utils), `/qr`, `/auth-popup`, `/decode`.

  **Removed from the public surface (folded into `@avokjs/core`):**

  - `@avokjs/vanilla` → **`@avokjs/core` main** (name hard-cut; import `@avokjs/core`).
  - `@avokjs/helpers` → **`@avokjs/core/helpers`** (+ `@avokjs/core/qr` for the browser QR transport).
  - `@avokjs/auth-origin` → **`@avokjs/core/auth-popup`** — now a mountable SDK component
    (`mountAuthPopup()` / `<AuthPopup>`) + a hardened-page emitter (`pnpm emit:auth-page`), not a
    clone-and-own static app. The two popup pages collapsed into one.
  - `@avokjs/shared-origin` → **`@avokjs/core/channel`**.
  - The six private engine packages (`sdk-core`, `wallet-core`, `evm-txengine`, `solana-txengine`,
    `provider`, `shared-origin`) → domain folders inside `@avokjs/core`. The "published packages must
    source types from `@avokjs/vanilla`" inversion is gone.

  **Facades rewired:** `@avokjs/react` → `@avokjs/core` (was `@avokjs/vanilla`); `@avokjs/react-native`
  → `@avokjs/core/engine`.

  **New DX components:** `<AuthPopup>` / `mountAuthPopup()` (the hosted auth page); `<SharedOrigin>` +
  `useAvokConnect()` (shared-origin connect); `usePairingCeremony()` + `<PairDevice>` (react) and
  `usePairingCeremony()` + `createExpoCameraTransport()` (react-native) for the QR pairing ceremony.

  **Migration:** replace `@avokjs/vanilla` → `@avokjs/core`, `@avokjs/helpers` → `@avokjs/core/helpers`,
  `@avokjs/auth-origin` → `@avokjs/core/auth-popup`, `@avokjs/shared-origin` → `@avokjs/core/channel`.
  No contract changes.

### Patch Changes

- Updated dependencies [9419676]
- Updated dependencies [75d96cd]
  - @avokjs/core@0.1.0
