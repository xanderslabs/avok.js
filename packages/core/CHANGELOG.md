# @avokjs/core

## 0.2.0

### Minor Changes

- cb8c699: Sponsorship is a per-transaction ask that is either served or fails, and the native-gas rail is renamed.

  **Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

  ```ts
  // paymaster pays the gas; the user is charged nothing (stock ERC-7677 verifying paymaster)
  await client.evm.send(calls, { chainId, sponsored: true });

  // paymaster fronts the gas; the user repays it in an ERC-20
  await client.evm.send(calls, { chainId, feeToken: USDC });

  // neither: the user pays native gas
  await client.evm.send(calls, { chainId });
  ```

  - **`ClientConfig.requireSponsorship` is removed.** Strictness moved onto the send, where sponsorship
    is actually asked for. A sponsorship request with no rail configured throws
    `SponsorshipUnavailableError` at build/simulate time, before the passkey ceremony, so no signature is
    taken. There is **no degrade to native gas and no flag that enables one**: a degrade either spends
    the user's own funds on a send the app meant to sponsor, or fails anyway on an error naming a native
    balance rather than the missing endpoint that caused it.
  - **Solana now enforces the same rule.** It previously had no guard at all: a missing `koraUrl`
    silently charged the user SOL regardless of what the app asked. `SponsorshipUnavailableError` gained
    `missing`, `hasKora`, and a `solana:<cluster>` chain id, and is built through
    `SponsorshipUnavailableError.evm()` / `.solana()`.
  - **Pure sponsorship is reachable.** `{ sponsored: true }` with no `feeToken` now takes the sponsored
    rail. Rail selection previously read the fee token alone, so the sponsored rail was unreachable for a
    user holding no token, and on any chain whose registry lists no fee tokens. Kora has no equivalent
    mode (it co-signs only a transaction that repays it), so on Solana that combination is an error.
  - **`rail: "self-pay"` is renamed to `rail: "native-gas"`** on every receipt, batch and simulation, on
    both chains. "Self-pay" described who did _not_ pay; "native-gas" says what the user actually spends,
    and it no longer implies a binary with "token fee" now that sponsorship can cost the user nothing.
    Internal helpers renamed to match (`selfPayFees` → `nativeGasFees`, `buildSelfPayCalldata` →
    `buildNativeGasCalldata`).
  - **"Fronted" is retired** from Avok's vocabulary, including the two error-map keys
    (`fronter_unavailable`, `not_fronted`) that used it — relics of the deleted bespoke relayer that no
    live service sends. Unknown reason codes still surface verbatim, so error diagnostics lose nothing.

- cb8c699: The Solana rail is removed. Avok is EVM-only.

  **Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

  The `./solana` and `./decode` subpaths, the Solana Wallet Standard entry (`registerAvokSolanaWallet`),
  `koraUrl`, `SponsorshipUnavailableError.solana()`, `client.exportSolanaKey()`, SNS name resolution, the
  Solana signing verbs, and the Solana chain registry entries are all removed. `K` is now the EVM key: the
  key container no longer produces a second curve.

  **The account shapes lose a member.** `Account` (`{ evm, solana }`), `AvokAccount`, `AuthPopupAccount`
  and `SharedAccount` are all EVM-only now, and `ExportedWallet` narrows from `{ evm, solana }` to
  `{ evm }`. Code that destructures the Solana member of any of them stops compiling. `evm` is untouched
  in every case, so the fix is to drop the member, never to remap it.

  **Two removals reach past the SDK's own surface.** `KoraRejectedError` is gone from all three packages'
  catchable-error exports, so an `instanceof` narrowing on it no longer type-checks. And `<SharedOrigin>`
  in `@avokjs/react` no longer accepts a `koraUrl` prop.

  Also removed, as the rail's dependents: `readSolanaBalances`, `solanaTokens`, `solanaExplorerTxUrl`, and
  seven dependencies (`@solana/kit`, the three `@solana-program/*` packages,
  `@solana-name-service/sns-sdk-kit`, and both `@wallet-standard/*` packages).

  Two signatures narrow because their Solana branch was the only thing they selected between:
  `resolveRecipient(resolver, input, rail)` drops `rail` (and the `Rail` type), and
  `createNameResolver({ ens, sns })` drops `sns`.

  Removable rather than barred: secp256k1 derives an ed25519 key from the same seed, so restoring the
  rail later is cheap. The normative `SOLANA_KEY_INFO` HKDF domain and its pinned test vectors are in git
  history, and restoring the rail means restoring those exact values rather than re-deriving them, since
  they are what make a restored wallet the SAME wallet. ENS resolution is unaffected and stays in scope.

### Patch Changes

- Updated dependencies [cb8c699]
  - @avokjs/contracts@0.2.0

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
