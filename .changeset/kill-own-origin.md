---
"@avokjs/core": minor
"@avokjs/react": minor
"@avokjs/react-native": minor
---

Popup-for-all: own-origin (in-page) signing is retired. Every app now gets the same custody posture,
and configures it with one value.

**Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

```ts
// before
import { createOwnOriginConnection } from "@avokjs/core";
const client = createAvokClient({ connection: createOwnOriginConnection({ rpId: "example.com" }) });

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
