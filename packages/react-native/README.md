# @avokjs/react-native

Avok for React Native / Expo. **The passkey *is* the wallet** — `K = HKDF(PRF(credential, rpId))`,
derived on every use and stored nowhere.

```bash
npm i @avokjs/react-native react react-native react-native-passkey expo-secure-store
```

Peer deps: `react`, `react-native`, `expo-secure-store`. The passkey module is **injected**, not a
dependency of this package — pass `react-native-passkey` (or any object matching
`ReactNativePasskeyLike`, which is what tests do). Passkeys require a PRF-capable provider: iCloud
Keychain or Google Password Manager.

## Native setup — required, and nothing works without it

An `rpId` is a domain claim, and the OS refuses to honour it unless the domain claims you back. This
is not Avok configuration; it is the platform's, and a passkey call fails at the OS layer without it.

- **iOS** — add the `webcredentials:<your-rpId>` entitlement (Associated Domains) and serve
  `/.well-known/apple-app-site-association` from that domain with your app's identifier.
- **Android** — serve `/.well-known/assetlinks.json` from that domain with your package name and
  signing-certificate fingerprint (Digital Asset Links).

Expo: both are config-plugin territory (`app.json` `associatedDomains` and the Android intent-filter
setup); they cannot be set from JavaScript. The `rpId` you pass below **must** be that same domain.

## Quickstart

```tsx
import { Passkey } from "react-native-passkey";
import {
  AvokProvider, createAvokClient, createOwnOriginConnection, secureStoreStorage, useAccount,
} from "@avokjs/react-native";

const client = createAvokClient(
  {
    connection: createOwnOriginConnection({
      rpId: "example.com",          // explicit — it is an input to the wallet key
      passkey: Passkey,             // required
      storage: secureStoreStorage(),
    }),
  },
  // The OPERATOR's identity. Required, and never defaulted to an Avok brand: a wallet cannot
  // honestly announce itself anonymously.
  { name: "Example Wallet", rdns: "com.example.wallet" },
);

export default () => (
  <AvokProvider client={client}>
    <Wallet />
  </AvokProvider>
);
```

## Hooks

| | |
|---|---|
| `useAvok` `useSelfCustody` | raw client, custody introspection |
| `useAccount` `useCreate` `useLogin` `useLogout` | account lifecycle |
| `useEnroll` `useExport` `useAccessSlots` | management verbs (self-custody) |
| `usePairingCeremony` | QR device pairing |

Each returns `{ pending, error }` alongside its action, so a failed passkey gesture surfaces where you
render it rather than as an unhandled rejection.

**Sending and signing are not hooks.** They go through the EIP-1193 provider
(`client.getEip1193Provider()`) and the Solana Wallet Standard wallet, driven by stock wagmi/viem and
`@solana/wallet-adapter`. On pure native the EIP-6963 / Wallet Standard announce is a no-op — there is
no page to announce into — so reach for the provider directly.

The hook surface otherwise matches [`@avokjs/react`](https://www.npmjs.com/package/@avokjs/react).

## Shared-origin is not supported on native

There is **no shared-origin path in this package**. The native auth-session channel
(`ASWebAuthenticationSession` / Custom Tabs) was deleted because it never worked, and nothing replaced
it. `@avokjs/react-native` is own-origin only.

`@avokjs/core` does export `createSharedOriginConnection`, but it takes an injected
`channel: SigningChannel`, and the only channel shipped anywhere is DOM-only (`window.open`). A native
app would have to implement that transport itself over `expo-web-browser` or similar. That is
unsupported territory, not a documented path.

## Device pairing

`usePairingCeremony` runs the three-round QR ceremony over an injected transport;
`createExpoCameraTransport` bridges `expo-camera`, which is render-driven and so cannot be called
imperatively. Both the ceremony phase machine and the transport are unit-tested.

## Status

Unit-tested: SecureStore storage and its fallbacks, provider reactivity, the management hooks, the
pairing phase machine, and the camera transport. The passkey adapter is tested in `@avokjs/core`.

**Not exercised on a device:** real passkey biometrics, the real SecureStore keychain, and camera
pairing. Untested in this package: `createOwnOriginConnection`, the provider wiring, `useLogin` and
`useLogout`. Treat this package as functional but less-travelled than the web facade — see
`VERIFICATION.md`.

## Removing a device's access

Pairing gives the other device **its own key to this wallet**, wrapped under **its own passkey**. The
SDK never keeps `K` at rest — it is derived per gesture and wiped immediately after (`wipeSecrets`), so
a device's lasting access is exactly *its passkey* plus *its encrypted access slot on chain*.

`listAccessSlots()` enumerates them — each carries the `rpId` that enrolled it, so you can tell them
apart — and `removeAccessSlot(slotId, { confirm: true })` deletes one. Both are on `useAccessSlots()`.
On a faithful client this **denies future access**: without its blob there is nothing left for that
passkey to decrypt, so it cannot reconstruct the key on a fresh session.

**Removal is housekeeping, not revocation**, and no UI may present it as a security control. It cannot
*guarantee* the key was never kept — a device compromised or running a modified ceremony *while in use*
could have exfiltrated `K` live, and no on-chain action un-copies it. The blob was public calldata and
stays in chain history forever; and because every passkey signs as the same `K`, any passkey can remove
any other. So:

> **If a paired device is lost or compromised, removal is not enough — move your funds to a new wallet.**

Tell your users that *before* they pair, and only pair devices you control.
