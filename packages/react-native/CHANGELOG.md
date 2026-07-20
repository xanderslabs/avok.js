# @avokjs/react-native

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

- 75d96cd: Send-path redesign: thin the transaction path onto standard tooling, and standardize the
  sponsored-gas rail vocabulary. (The surfaces below were consolidated into `@avokjs/core` by the
  package restructure — see the restructure changeset; the semantics are unchanged.)

  - **Rail terminology `fronted` → `sponsored`** (both EVM and Solana). User-visible surface changes:
    - `Receipt.rail` is now `"self-pay" | "sponsored"` (was `"fronted"`); the consent/fee disclosure
      and capability plumbing follow (`@avokjs/core`, `@avokjs/react-native`).
    - The shared-origin popup signer verb `signFronted` is renamed `signSponsored`
      (`@avokjs/core/channel`).
    - The auth-popup consent copy says "Sponsored" instead of "Fronted" (`@avokjs/core/auth-popup`).
  - **`classifySendError()` — BREAKING:** the `SendErrorKind` value `"fronted-unavailable"` is renamed
    `"sponsored-unavailable"` (`@avokjs/core/helpers`). Consumers matching on the old value must update.
    The relayer's external `RELAYER_REASON` wire keys (e.g. `not_fronted`) are unchanged.
  - **Oracle retired:** the private `@avokjs/oracle` package is deleted; the sponsored consent fee is now
    sourced from the ERC-7677 paymaster/gas quote (no USD oracle conversion).

  No contract changes; the wallet lifecycle surface (`create`/`login`/`logout`/account/access-key/export)
  is unchanged.

### Patch Changes

- Updated dependencies [9419676]
- Updated dependencies [75d96cd]
  - @avokjs/core@0.1.0
  - @avokjs/contracts@0.1.0
