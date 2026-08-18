---
"@avokjs/core": minor
"@avokjs/react": minor
"@avokjs/react-native": minor
---

Device roster and guardian-set management, plus roster-signer support on sends.

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
