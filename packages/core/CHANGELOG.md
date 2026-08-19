# @avokjs/core

## 0.2.0

### Minor Changes

- 7ff98e0: The D8 key model: `K = HKDF(PRF(passkey))`, derived per gesture and wiped, with no more PRF-blob/SAS
  enrolment scheme.

  **Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

  - **`@avokjs/core/wallet` drops the whole PRF-blob/SAS-pairing surface**: `deriveSlotId`,
    `encodeAccessHandle`, `decodeUserHandle`, `UserHandle`, `decryptKeyBlob`, `serializeBlob`,
    `deserializeBlob`, `BLOB_BYTES`, `EncryptedKeyBlob`/`BlobVersion`, `META_BYTES`, `ExportedWallet`,
    `addPasskey`, `exportWallet`, `reconstructFromKey`, `reconstructWalletState`, `ACCESS_VAULT_ABI`,
    `buildAddAccessSlotCall`, `buildRemoveAccessSlotCall`, `VaultUnreadableError`, `listAccessSlots`,
    `AccessSlotEntry`/`RosterReader`, `readAccessSlotRpId`, `vaultForChainFromRegistry`, `resolveBlob`,
    `BlobSource`/`ResolveBlobResult`, `AccessSlotOffer`/`AccessSlotWrap`, and the wallet-scoped
    `Call`/`VaultReader` types. That whole ceremony — wrap the shared key under a second device's PRF
    and ship the ciphertext on chain — is gone; K never travels between devices under any scheme now.
  - **`WalletState` no longer carries blob/slot fields.** A device's local state is just its own
    derived address, its credential id, and (for a non-founding device) the wallet address it signs
    for — there is no more multi-slot roster in local state, because there is no more shared key for
    multiple slots to decrypt their way to.
  - **New: `createDeviceEnrollmentRequest`/`verifyDeviceEnrollmentRequest`.** A new device derives its
    own independent key (never a copy of anyone else's) and proves control of it for a named wallet; an
    existing signer verifies the proof and registers the address on chain (`@avokjs/core/evm`'s
    `buildRegisterDeviceCall` — see the roster/guardian changeset).

- 7ff98e0: Popup-for-all: own-origin (in-page) signing is retired. Every app now gets the same custody posture,
  and configures it with one value.

  **Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

  ```ts
  // before
  import { createOwnOriginConnection } from "@avokjs/core";
  const client = createAvokClient({
    connection: createOwnOriginConnection({ rpId: "example.com" }),
  });

  // after
  import { createAvok } from "@avokjs/core";
  const client = await createAvok({
    originPoint: "https://vault.example.com", // yours, or someone else's — permissionless
    chains: ["base"],
    wallet: { name: "Example Wallet", rdns: "com.example.wallet" },
  });
  ```

  - **`createOwnOriginConnection` is gone from every package that had it** (`@avokjs/core`,
    `@avokjs/react`, `@avokjs/react-native`). There is no more in-page signing path: all key material
    lives in the origin-point Vault, and every app — first-party or guest — reaches it through the same
    popup.
  - **`createAvok` is the new one-call factory.** `createAvokClient`/`createSharedOriginConnection`
    remain for hand-wiring a custom `ClientConfig` (a custom channel transport, for example);
    `createSharedOriginConnection`'s `authOrigin` parameter is renamed to `originPoint`, and
    `createNativeSharedOrigin` (`@avokjs/react-native`) the same.
  - **`rpId`/`authOrigin` are gone from the SDK's public API entirely.** They are now build-time
    configuration on the origin-point's own build (`avok-vault init`), never something an app passes.
  - **`FullAvokClient`/`UseOnlyAvokClient`/`AvokClientFor<C>` are gone, replaced by one `AvokClient`
    type.** There is no more a custody-posture-conditional client shape — every client has the same
    surface.
  - **Catchable error exports removed** (own-origin-specific, no longer reachable): `EnrolmentUnaffordableError`,
    `VaultUnreadableError`, `OrphanedCredentialError`, `SlotUnreachableError`, `EnrolmentBlockedError`.
  - **React hooks removed:** `useSelfCustody`, `useCreate`, `useEnroll`, `useExport`, `useAccessSlots`,
    `usePairingCeremony`, and the `<PairDevice>` component. **React Native:** `usePairingCeremony` and
    `createExpoCameraTransport`. Wallet lifecycle beyond login (create, guardians, recovery, devices) now
    runs through the origin-point Vault's own surfaces, not custody-conditional client-side hooks.
  - **`@avokjs/core/pairing-window` subpath removed.** `./qr` stays — the browser QR transport primitive
    survives as a building block, just not wired to the retired pairing ceremony.

- 7ff98e0: Device roster and guardian-set management, plus roster-signer support on sends.

  - **New in `@avokjs/core/evm`:** `buildRegisterDeviceCall`/`buildRevokeDeviceCall`/`readDeviceRoster`
    (who can sign for the wallet) and `buildSetupGuardiansCall`/`buildProposeGuardianOpCall`/
    `buildExecuteGuardianOpCall`/`buildVetoGuardianOpCall`/`readGuardianState` (who can recover it).
    Both are ordinary wallet self-calls (`onlyThis`/`onlySelf` on the wallet contract) — build the
    `Call`, then send it through the announced EIP-1193 provider like any other transaction. No new
    signing primitive.
  - **New in `@avokjs/react`/`@avokjs/react-native`:** `useDevices`/`useGuardians` hooks, thin wrappers
    over the builders/reads above. They never sign or submit; that stays the app's own
    `sendTransaction`/`writeContract`.
  - **A device enrolled after the founding one can now sign an ordinary send.** Calibur authorizes
    `execute(mode, executionData)` by caller identity, so a registered device's own transaction
    signature already worked; the sponsored (4337) rail needed a wrapped-signature envelope naming
    which registered key signed (`@avokjs/core/evm`'s `wrapRosterSignature`/`computeSecp256k1KeyHash`),
    which is new.
  - **Not yet supported for a non-founding device:** `signMessage`/`signTypedData`/`signSiwe` and the
    `connect`/authorize flow. Calibur verifies those through ERC-1271, whose non-root-key branch
    requires ERC-7739 nested-typed-data signing — ordinary wrapping is not enough, and that scheme is
    not implemented yet. Calling one of these as a non-founding device throws a clear error rather than
    producing a signature Calibur would silently reject.
  - **No `useRecovery` hook.** A guardian's own approval of a recovery is a different actor's action
    (their key, not the wallet's) and runs on the origin-point Vault's own recovery screen — there is no
    dapp-side entry point for a hook to wrap.

- 7ff98e0: Two new internal modules, both consumed by the origin-point Vault rather than exported from the
  package: transaction simulation and guardian-recovery flow control.

  - **`vault/simulate`** wires `eth_simulateV1` (falling back to `status: "unsimulated"` on a chain
    that lacks it, with reverts blocking rather than hiding the send) into the consent screen: what a
    batch is about to move is decoded from the transaction itself and shown as asset-delta rows, not
    taken on trust from the calldata's own labels.
  - **`vault/recover`** drives the guardian-recovery UI end to end: read a wallet's guardian config
    and any pending recovery, collect a guardian's EIP-712 approval, and reach execute or veto.

  Neither is part of `@avokjs/core`'s public subpath exports (see the vault README's recovery screen,
  and the roster-and-guardian-management changeset for the on-chain calldata builders these two
  modules call into).

- cb8c699: Sponsorship is a per-transaction ask that is either served or fails, and the native-gas rail is renamed.

  **Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

  The semantics below are the `EvmNamespace` (`@avokjs/core/evm`) `send`/`simulate` surface a dapp
  reaches through the announced EIP-1193 provider (`wallet_sendCalls`, ERC-5792), not a method on
  `AvokClient` itself — the client exposes no `.evm` field:

  ```ts
  // paymaster pays the gas; the user is charged nothing (stock ERC-7677 verifying paymaster)
  { chainId, sponsored: true }

  // paymaster fronts the gas; the user repays it in an ERC-20
  { chainId, feeToken: USDC }

  // neither: the user pays native gas
  { chainId }
  ```

  - **`ClientConfig.requireSponsorship` is removed.** Strictness moved onto the send, where sponsorship
    is actually asked for. A sponsorship request with no rail configured throws
    `SponsorshipUnavailableError` at build/simulate time, before the passkey ceremony, so no signature is
    taken. There is **no degrade to native gas and no flag that enables one**: a degrade either spends
    the user's own funds on a send the app meant to sponsor, or fails anyway on an error naming a native
    balance rather than the missing endpoint that caused it.
  - **Pure sponsorship is reachable.** `{ sponsored: true }` with no `feeToken` now takes the sponsored
    rail. Rail selection previously read the fee token alone, so the sponsored rail was unreachable for a
    user holding no token, and on any chain whose registry lists no fee tokens.
  - **`rail: "self-pay"` is renamed to `rail: "native-gas"`** on every receipt, batch and simulation.
    "Self-pay" described who did _not_ pay; "native-gas" says what the user actually spends, and it no
    longer implies a binary with "token fee" now that sponsorship can cost the user nothing. Internal
    helpers renamed to match (`selfPayFees` → `nativeGasFees`, `buildSelfPayCalldata` →
    `buildNativeGasCalldata`).
  - **"Fronted" is retired** from Avok's vocabulary, including the two error-map keys
    (`fronter_unavailable`, `not_fronted`) that used it — relics of the deleted bespoke relayer that no
    live service sends. Unknown reason codes still surface verbatim, so error diagnostics lose nothing.

  Solana-specific behavior originally described here (Kora sponsorship enforcement,
  `SponsorshipUnavailableError.solana()`) is dropped from this note: the Solana rail is removed outright
  in this same release — see the EVM-only changeset — so documenting a rule for a rail that no longer
  ships would be describing dead code.

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

- 7ff98e0: Drop `@noble/hashes` and `@scure/base` from `dependencies`. Both were genuinely dead after the D8
  migration deleted the PRF-blob/SAS code that used them (re-verified against the built `dist`, not
  just source grep, since a stale comment in `runtime-deps.test.ts` had insisted all three were
  load-bearing transitive imports for Metro). `@noble/curves` stays: secp256k1 signing is still live.
- Updated dependencies [7ff98e0]
- Updated dependencies [7ff98e0]
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
