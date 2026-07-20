# @avokjs/react

React bindings for Avok. **The passkey *is* the wallet**: `K = HKDF(PRF(credential, rpId))`, derived
on every use and stored nowhere.

```bash
npm i @avokjs/react react
```

Peer dependency: `react >=19.2.7`.

## Quickstart

Build an own-origin wallet, where your app owns the passkey's `rpId` and signs in code:

```tsx
import {
  AvokProvider, createAvokClient, createOwnOriginConnection, useAccount, useCreate,
} from "@avokjs/react";

const client = createAvokClient(
  { connection: createOwnOriginConnection({ rpId: "example.com" }) },
  // The operator's identity, shown in wallet pickers. `name` and `rdns` are required and are never
  // defaulted to an Avok brand.
  { name: "Example Wallet", rdns: "com.example.wallet" },
);

function Wallet() {
  const { account } = useAccount();
  const { create, pending, error } = useCreate();
  if (!account) {
    return (
      <button disabled={pending} onClick={() => create()}>
        Create wallet
      </button>
    );
  }
  return <p>{account.evm.address}{error && <span>{error.message}</span>}</p>;
}

export default function App() {
  return (
    <AvokProvider client={client}>
      <Wallet />
    </AvokProvider>
  );
}
```

## Hooks

The hooks cover the wallet lifecycle. Each mutation hook returns `pending` and `error` next to its
action, so a failed passkey gesture or a rejected signature surfaces where you render it.

| Hook | What it does |
| --- | --- |
| `useAvok` | Returns the use-only client. Works on any connection. |
| `useSelfCustody` | Returns the full client. Throws on a shared-origin (use-only) connection. |
| `useAccount` | Reactive `{ account, status }` snapshot. |
| `useCreate` | Create a wallet with a passkey. Self-custody only. |
| `useLogin` | Start a session. |
| `useLogout` | End a session. |
| `useEnroll` | Add an access key. Self-custody only. |
| `useExport` | Export the raw EVM and Solana keys. Self-custody only. |
| `useAccessSlots` | List, refresh, and remove access keys. Self-custody only. |
| `useAvokConnect` | Shared-origin connect trigger. Returns `isPending` and `isConnected`. |
| `usePairingCeremony` | Drive the device-pairing phase machine. |

Components: `AvokProvider`, `AuthPopup`, `SharedOrigin`, and `PairDevice`. The [React
reference](../../docs/reference/react.mdx) has the exact return shapes and props.

## Sending and signing are not hooks

`createAvokClient` announces an EIP-1193 provider over EIP-6963 and registers a Solana Wallet
Standard wallet. You send and sign with the stock ecosystem tools, wagmi and viem or
`@solana/wallet-adapter`, which discover Avok like any other wallet. `client.getEip1193Provider()`
returns the provider directly if you are not using a connector library.

Earlier versions of this package shipped `useSend`, `useSimulate`, `useSign`, and `useFeeTokens`,
plus the Solana equivalents. They are gone.

## Shared-origin

Own-origin (above) is self-custody with no server. Shared-origin points your app at an operator that
hosts the wallet. Your app receives signatures through a popup and cannot derive key material,
because WebAuthn will not let an origin request an `rpId` it does not own.

`<SharedOrigin>` does the async wiring. It builds the popup-backed connection, constructs the client,
and renders the provider beneath it.

```tsx
import { SharedOrigin } from "@avokjs/react";

<SharedOrigin
  auth="https://wallet.example.com"
  wallet={{ name: "Example Wallet", rdns: "com.example.wallet" }}
  fallback={<Spinner />}
  onError={(e) => console.error(e)}
>
  <App />
</SharedOrigin>;
```

`createSharedOriginConnection` is also exported for hand-wiring. It takes an injected `channel:
SigningChannel`. `<SharedOrigin>` builds the popup channel for you and imports it dynamically, so an
own-origin-only app never pulls that chunk.

## rpId and RPC

`rpId` is an input to the wallet key. Change it and every user gets a different wallet, so set it
explicitly. The SDK refuses to start without it.

Avok ships no third-party RPC as a default, because an RPC decides what address a name resolves to,
and therefore where money goes. Pass `rpcUrls` to `createAvokClient`.

## Removing a device's access

`removeAccessSlot(slotId, { confirm: true })` destroys the access key's ciphertext on chain, so a
removed passkey has nothing left to decrypt on a fresh session. Removal is real revocation, and it is
bounded: it cannot un-copy a key a compromised device already took. Read [Remove
access](../../docs/guides/remove-access.mdx) for the exact guarantees and the guidance to give users
before they pair a device.

## Documentation

This package is a thin React layer over [`@avokjs/core`](../core). Full documentation lives in the
repo's [`docs/`](../../docs) site.
