# @avokjs/wallet-core

## 0.0.1

### Patch Changes

- Updated dependencies [b656bf5]
- Updated dependencies [de78a4d]
  - @avokjs/chains@0.1.0
  - @avokjs/contracts@0.1.0

## 0.6.0

### Minor Changes

- 6163894: Embed the wallet username in the WebAuthn user handle so it survives sign-in
  with no server storage.

  The user handle now uses a versioned, length-prefixed layout
  (`[0]` format version `0x01`, `[1..21)` 20-byte wallet address, `[21]` username
  UTF-8 length `N` (`N <= 31`), `[22..22+N)` username UTF-8; total `<= 53` bytes,
  within WebAuthn's 64-byte `user.id` cap). `discover()` decodes it and returns the
  username as `DiscoveredPasskey.name`, and `useAvokAccessWallet().discover()`
  surfaces it on `WalletState.name`. `reconstructWalletState` gains an optional
  `name` argument.

  Wallet labels are sanitized before display/embedding via the new exported
  `sanitizeWalletLabel`: NFD-fold accented Latin to base ASCII (`José` → `Jose`),
  keep only ASCII name characters (`A–Z a–z 0–9`, space, and `-_.'`), then collapse
  whitespace and trim. Emoji, symbols, non-Latin scripts, and invisible/bidi
  control characters that enable display spoofing are dropped. Applied in
  `createWallet` and
  `completeDeviceProvisioning`; when nothing displayable remains, both fall back to
  the new exported `defaultWalletName(address)` — `"Avok wallet <last 4 address
chars>"` — so unnamed wallets stay distinguishable without a counter or server
  state.

  `discover()` returns the wallet address EIP-55-checksummed.

  Backward compatible: existing wallets whose handle is the bare 20-byte address
  keep working, with `name` absent. The on-chain `keccak256(label)` backup-slot
  label is unchanged — the display name in the handle is separate.

### Patch Changes

- @avokjs/chains@0.6.0
- @avokjs/contracts@0.6.0

## 0.5.0

### Minor Changes

- 6f82dd0: Add React Native / Expo adapter support.

  - `@avokjs/wallet-core`: `createReactNativePasskeyAdapter` (injected
    `react-native-passkey`, no hard dependency) backed by the encapsulated PRF
    salt; the PRF salt is now built lazily and `WebAuthnPasskeyAdapter` no longer
    reads `window` at construction, making core import-safe on React Native.
  - `@avokjs/react`: `AvokProvider` accepts an async storage adapter
    (`AvokAsyncStorage`) in addition to synchronous browser `Storage`, with the
    browser hydration path preserved exactly; it no longer constructs the WebAuthn
    adapter off-browser (pass a `passkey` instead). New `@avokjs/react/native`
    subpath exports `createExpoSecureStoreAvokStorage`,
    `createAsyncStorageAvokStorage`, and re-exports `createReactNativePasskeyAdapter`.
    `react-dom` is now an optional peer dependency.

  Browser usage is unchanged. A Web Crypto polyfill is required on native (see
  `docs/react-native.md`).

### Patch Changes

- @avokjs/chains@0.5.0
- @avokjs/contracts@0.5.0

## 0.4.4

### Patch Changes

- 7ee583d: Expose a proxied Avok RPC endpoint in config and let React derive the RPC URL from backend config.
- Updated dependencies [7ee583d]
  - @avokjs/chains@0.4.4
  - @avokjs/contracts@0.4.4

## 0.4.2

### Patch Changes

- cb4b18c: Add synchronized dynamic appwallet target support and related server/react updates.
- Updated dependencies [cb4b18c]
  - @avokjs/chains@0.4.2
  - @avokjs/contracts@0.4.2

## 0.4.1

### Patch Changes

- @avokjs/chains@0.4.1
- @avokjs/contracts@0.4.1

## 0.4.0

### Minor Changes

- Publish prepared SIWE challenge helpers and the React prepare/signPrepared hook surface.

### Patch Changes

- @avokjs/chains@0.4.0
- @avokjs/contracts@0.4.0

## 0.3.0

### Minor Changes

- Add prepared SIWE challenge helpers so apps can render the exact EIP-4361 message before signing, and update the React hook to expose prepare/signPrepared.

### Patch Changes

- Updated dependencies [f5a1e8b]
  - @avokjs/chains@0.3.0
  - @avokjs/contracts@0.3.0

## 0.2.0

### Minor Changes

- 7195d12: First public release. EIP-7702 passkey wallet infrastructure: local key generation and signing, WebAuthn PRF encryption, multi-passkey onchain backup, appWallet sponsored relay with primary-token fees, powerWallet self-paid mode, sponsor engine with quote and queue, SQLite and Postgres storage adapters, and a React provider with hooks for the full flow. Unaudited. Testnet use only.

### Patch Changes

- Updated dependencies [7195d12]
  - @avokjs/chains@0.2.0
  - @avokjs/contracts@0.2.0
