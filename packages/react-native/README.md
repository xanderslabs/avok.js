# @avokjs/react-native

Avok for React Native and Expo. **The passkey *is* the wallet**: `K = HKDF(PRF(credential, rpId))`,
derived on every use and stored nowhere.

```bash
npm i @avokjs/react-native react react-native react-native-passkey expo-secure-store
```

Peer dependencies: `react >=19.2.7`, `react-native >=0.86.0`, and `expo-secure-store >=57.0.0`. The
passkey module is injected, not a dependency of this package. Pass `react-native-passkey`, or any
object that matches `ReactNativePasskeyLike`. Passkeys need a PRF-capable provider, such as iCloud
Keychain or Google Password Manager.

## Native setup

An `rpId` is a domain claim, and the OS honors it only if the domain claims your app back. This is
platform configuration, not Avok configuration, and a passkey call fails at the OS layer without it.

- **iOS**: add the `webcredentials:<your-rpId>` entitlement (Associated Domains) and serve
  `/.well-known/apple-app-site-association` from that domain with your app's identifier.
- **Android**: serve `/.well-known/assetlinks.json` from that domain with your package name and
  signing-certificate fingerprint (Digital Asset Links).

In Expo, both are config-plugin territory (`app.json` `associatedDomains` and the Android
intent-filter setup); you cannot set them from JavaScript. The `rpId` you pass must be that same
domain.

## Quickstart

```tsx
import { Passkey } from "react-native-passkey";
import {
  AvokProvider, createAvokClient, createOwnOriginConnection, secureStoreStorage, useAccount,
} from "@avokjs/react-native";

const client = createAvokClient(
  {
    connection: createOwnOriginConnection({
      rpId: "example.com",          // an input to the wallet key
      passkey: Passkey,             // required
      storage: secureStoreStorage(),
    }),
  },
  // The operator's identity. `name` and `rdns` are required and are never defaulted to an Avok brand.
  { name: "Example Wallet", rdns: "com.example.wallet" },
);

export default () => (
  <AvokProvider client={client}>
    <Wallet />
  </AvokProvider>
);
```

## Hooks

The hooks match `@avokjs/react`, without `useAvokConnect`, which is web-only: `useAvok`,
`useSelfCustody`, `useAccount`, `useCreate`, `useLogin`, `useLogout`, `useEnroll`, `useExport`,
`useAccessSlots`, and `usePairingCeremony`. Each mutation hook returns `pending` and `error` next to
its action. The [React Native reference](../../docs/reference/react-native.mdx) has the exact return
shapes.

## Sending and signing are not hooks

They go through the EIP-1193 provider (`client.getEip1193Provider()`) and the Solana Wallet Standard
wallet, driven by stock wagmi and viem or `@solana/wallet-adapter`. On pure native there is no page
to announce into, so the EIP-6963 and Wallet Standard announce is a no-op. Reach for the provider
directly.

## Shared-origin

Shared-origin ships on native. Use `createNativeSharedOrigin` to run the signing ceremony in an
in-app browser tab at the operator's origin and bring back only the result. This is the path for apps
that do not own the wallet's `rpId` domain, and so cannot host its `apple-app-site-association` or
`assetlinks.json`.

```tsx
import * as WebBrowser from "expo-web-browser";
import { createAvokClient, createNativeSharedOrigin } from "@avokjs/react-native";

const connection = createNativeSharedOrigin({
  authOrigin: "https://wallet.example.com",
  redirectUri: "exampleapp://auth",
  openAuthSession: (url, redirectUri) => WebBrowser.openAuthSessionAsync(url, redirectUri),
});

const client = createAvokClient(
  { connection },
  { name: "Example Wallet", rdns: "com.example.wallet" },
);
```

A native callback URL carries no origin authenticity, so the account self-authenticates: `connect()`
verifies a signature over a caller nonce before trusting the account. Keep returned payloads to a few
kilobytes, because Android's Binder buffer is shared process-wide.

Measured on device (2026-07-20): a WebAuthn ceremony with the PRF extension succeeds inside both iOS
ASWebAuthenticationSession and Android Chrome Custom Tabs, the feasibility gate for deriving the
wallet key from PRF inside the tab.

## Device pairing

`usePairingCeremony` runs the two-round QR ceremony over an injected transport. The `transport` is
required on React Native, which ships no camera view. `createExpoCameraTransport` bridges
`expo-camera`. Both the phase machine and the transport are unit-tested.

## Removing a device's access

`removeAccessSlot(slotId, { confirm: true })` destroys the access key's ciphertext on chain, so a
removed passkey has nothing left to decrypt on a fresh session. Removal is real revocation, and it is
bounded: it cannot un-copy a key a compromised device already took. Read [Remove
access](../../docs/guides/remove-access.mdx) for the exact guarantees and the guidance to give users.

## What is verified

Unit tests cover `createOwnOriginConnection` and its required-`passkey` refusal, the native passkey
adapter seam, the provider wiring (including that it builds no DOM dependency), SecureStore and its
fallbacks, provider reactivity and resync, the hook surface, the pairing phase machine, and the
camera transport. Real passkey biometrics, the real SecureStore keychain, and camera pairing need
hardware. See `VERIFICATION.md` for the device checklist.

## Documentation

This package is a thin React Native layer over [`@avokjs/core`](../core), built on
`@avokjs/core/engine`. Full documentation lives in the repo's [`docs/`](../../docs) site.
