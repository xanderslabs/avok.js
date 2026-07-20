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

## Shared-origin: not shipped yet, but proven possible

This package is **own-origin only today**. There is no shared-origin connection in it, and
`@avokjs/core`'s `createSharedOriginConnection` takes an injected `channel: SigningChannel` whose only
shipped implementation is DOM-only (`window.open`). So there is nothing to point a native app at yet.

That is a missing feature, **not a platform limitation** — a distinction worth stating because the
older note here claimed otherwise. Shared-origin exists precisely for apps that do *not* own the
wallet's rpId domain and therefore cannot host its `apple-app-site-association` or `assetlinks.json`.
The answer on native is the same as on web: run the ceremony in a context that genuinely *is* that
origin — an in-app browser tab — and bring back only the result.

**Measured on device (2026-07-20):** a WebAuthn ceremony with the **PRF extension** succeeds inside
both **iOS ASWebAuthenticationSession** and **Android Chrome Custom Tabs**. Since Avok derives the
wallet key from PRF, that was the make-or-break question, and it passes on both platforms. RFC 8252 §6
endorses this shape and names both APIs.

What is left is building a native `SigningChannel` over that tab. Note
`ASWebAuthenticationSession` is one-shot — request → redirect, with no `postMessage` equivalent — so
the result returns via the callback URL. Keep returned payloads to a few KB: Android's Binder buffer
is shared process-wide, and iOS documents no limit at all.

If you need shared-origin on native before that ships, you can implement the `SigningChannel`
yourself against `@avokjs/core`'s `createSharedOriginConnection`. That is unsupported territory, but
it is not blocked.

## Device pairing

`usePairingCeremony` runs the three-round QR ceremony over an injected transport;
`createExpoCameraTransport` bridges `expo-camera`, which is render-driven and so cannot be called
imperatively. Both the ceremony phase machine and the transport are unit-tested.

## Status

Unit-tested: `createOwnOriginConnection` and its required-`passkey` refusal, the native passkey
adapter seam, the provider wiring (including that it builds no DOM dependency), SecureStore storage
and its fallbacks, provider reactivity and resync, the full hook surface, the pairing phase machine,
and the camera transport. The passkey adapter's own logic is tested in `@avokjs/core`.

**Not exercised on a device:** real passkey biometrics, the real SecureStore keychain, and camera
pairing — see `VERIFICATION.md` for the device checklist. Everything a unit test can reach is
covered; what remains needs hardware.

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
