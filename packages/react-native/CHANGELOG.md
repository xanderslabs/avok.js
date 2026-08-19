# @avokjs/react-native

## 0.2.0

### Minor Changes

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
- Updated dependencies [7ff98e0]
- Updated dependencies [7ff98e0]
- Updated dependencies [7ff98e0]
- Updated dependencies [7ff98e0]
- Updated dependencies [7ff98e0]
- Updated dependencies [cb8c699]
- Updated dependencies [cb8c699]
  - @avokjs/core@0.2.0
  - @avokjs/contracts@0.2.0

## 0.1.0

### Minor Changes

- 9419676: First release. React Native lifecycle and management hooks (`useEnroll` / `useExport` /
  `useAccessSlots`), `createAvokClient(config, wallet)`, and the native platform adapter (native
  passkey + SecureStore), all over `@avokjs/core/engine`. Pairing: `usePairingCeremony()` +
  `createExpoCameraTransport()`, with the camera injected. Never statically imports `react-native`
  or `expo-*`.

- 75d96cd: The sponsored-gas rail is named `sponsored` throughout: `Receipt.rail` is
  `"native-gas" | "sponsored"`, and the consent/fee disclosure and capability plumbing follow.

### Patch Changes

- Updated dependencies [9419676]
- Updated dependencies [75d96cd]
  - @avokjs/core@0.1.0
  - @avokjs/contracts@0.1.0
