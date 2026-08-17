# @avokjs/core

## 0.1.0

### Minor Changes

- 9419676: First release. `@avokjs/core` is the framework-agnostic SDK and the plain-JS/browser SDK:
  passkey-authenticated, self-custodial smart wallets on EVM (EIP-7702) and Solana, with no backend.

  Subpaths: `/engine` (platform-agnostic, no browser globals — the React Native base), `/wallet`,
  `/evm`, `/solana`, `/channel`, `/provider`, `/helpers` (name resolution + utils), `/qr`,
  `/auth-popup`, `/decode`.

  Components: `mountAuthPopup()` (the page an `rpId` owner hosts at their auth origin), the
  shared-origin channel, and the QR pairing ceremony.

- 75d96cd: The sponsored-gas rail is named `sponsored` throughout: `Receipt.rail` is
  `"native-gas" | "sponsored"`, the shared-origin popup signer verb is `signSponsored`, and
  `classifySendError()`'s `SendErrorKind` carries `"sponsored-unavailable"`. The sponsored consent
  fee is sourced from the ERC-7677 paymaster/gas quote — there is no USD oracle conversion.

### Patch Changes

- @avokjs/contracts@0.1.0
