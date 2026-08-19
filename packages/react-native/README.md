# @avokjs/react-native

Avok for React Native and Expo. **The passkey *is* the wallet**: `K = HKDF(PRF(credential))`, derived
inside the origin-point Vault on every gesture and stored nowhere.

```bash
npm i @avokjs/react-native react react-native
```

Peer dependencies: `react >=19.2.7`, `react-native >=0.86.0`, and `expo-secure-store >=57.0.0`
(optional, used by `secureStoreStorage()`).

## Quickstart

The signing ceremony always runs at the operator's `originPoint`, in an in-app browser tab
(`ASWebAuthenticationSession` on iOS, Chrome Custom Tabs on Android), never in your own app's
process, so there is no passkey domain claim to own or platform association files to serve for it.

```tsx
import * as WebBrowser from "expo-web-browser";
import {
  AvokProvider, createAvokClient, createNativeSharedOrigin, useAccount, useLogin,
} from "@avokjs/react-native";

const connection = createNativeSharedOrigin({
  originPoint: "https://vault.example.com", // yours, or someone else's (permissionless)
  redirectUri: "exampleapp://auth",
  openAuthSession: (url, redirectUri) => WebBrowser.openAuthSessionAsync(url, redirectUri),
});

const client = createAvokClient(
  { connection },
  // The operator's identity. `name` and `rdns` are required and are never defaulted to an Avok brand.
  { name: "Example Wallet", rdns: "com.example.wallet" },
);

export default function App() {
  return (
    <AvokProvider client={client}>
      <Wallet />
    </AvokProvider>
  );
}

function Wallet() {
  const { account } = useAccount();
  const { login, pending } = useLogin();
  if (!account) return <Button disabled={pending} onPress={() => login()} title="Connect" />;
  return <Text>{account.evm.address}</Text>;
}
```

A native callback URL carries no origin authenticity, so the account self-authenticates: `login()`
verifies a signature over a caller nonce before trusting the account. Keep returned payloads to a few
kilobytes: Android's Binder transaction buffer is 1 MB and shared across every transaction in the
process, so the room available depends on what else the app is doing, not on the payload alone.

This rail depends on the PRF extension evaluating inside the in-app browser tab, which is measured on
real hardware rather than assumed. See `VERIFICATION.md` §3b for the result, its date, the minimum OS
versions, and how to re-run the check.

## Hooks

Same surface as `@avokjs/react`, minus the web-only `useAvokConnect`: `useAvok`, `useAccount`,
`useLogin`, `useLogout`, `useDevices`, `useGuardians`. Each mutation hook returns `pending` and
`error` next to its action.

## Sending and signing are not hooks

They go through the EIP-1193 provider (`client.getEip1193Provider()`), driven by stock wagmi and
viem. On pure native there is no page to announce into, so the EIP-6963 announce is a no-op. Reach
for the provider directly.

`useDevices`/`useGuardians` follow the same rule: they build a `{ to, value, data }` self-call. Device
registration and guardian-set changes are ordinary wallet transactions, and you send it through the
provider. Neither hook signs or submits anything itself. A guardian's own *approval* of a recovery
runs on the origin-point's own recovery screen, not through this SDK.

## Documentation

This package is a thin React Native layer over [`@avokjs/core`](../core), built on
`@avokjs/core/engine`. See that package's README for the underlying config, subpaths, and the
sponsorship contract.
