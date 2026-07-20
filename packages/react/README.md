# @avokjs/react

React bindings for Avok. **The passkey *is* the wallet** — `K = HKDF(PRF(credential, rpId))`, derived
on every use and stored nowhere.

```bash
npm i @avokjs/react react
```

```tsx
import { AvokProvider, createAvokClient, createOwnOriginConnection, useAccount, useCreate } from "@avokjs/react";

const client = createAvokClient(
  { connection: createOwnOriginConnection({ rpId: "example.com" }) }, // explicit — see below
  // The OPERATOR's identity, shown in dapp pickers. Required, and never defaulted to an Avok
  // brand: a wallet cannot honestly announce itself anonymously.
  { name: "Example Wallet", rdns: "com.example.wallet" },
);

function App() {
  return (
    <AvokProvider client={client}>
      <Wallet />
    </AvokProvider>
  );
}

function Wallet() {
  const { account } = useAccount();
  const { create, pending, error } = useCreate();

  if (!account) return <button disabled={pending} onClick={() => create()}>Create wallet</button>;
  return <p>{account.evm.address}{error && <span>{error.message}</span>}</p>;
}
```

## Hooks

| | |
|---|---|
| `useAvok` `useSelfCustody` | raw client, custody introspection |
| `useAccount` `useCreate` `useLogin` `useLogout` | account lifecycle |
| `useEnroll` `useExport` `useAccessSlots` | management verbs (self-custody) |
| `useAvokConnect` | shared-origin connect trigger |
| `usePairingCeremony` `PairDevice` | QR device pairing |

Every hook returns `{ pending, error }` alongside its action, so a failed passkey gesture or a rejected
signature surfaces where you render it — not as an unhandled rejection.

## Sending and signing are not hooks

`createAvokClient` announces an **EIP-1193 provider** over EIP-6963 and registers a **Solana Wallet
Standard** wallet. You send and sign with the stock ecosystem tools — wagmi/viem, or
`@solana/wallet-adapter` — which discover Avok like any other wallet. `client.getEip1193Provider()`
hands you the provider directly if you are not using a connector library.

This is deliberate: a wallet that made you learn its own `useSend` would be a worse wallet. Earlier
versions of this package shipped `useSend` / `useSimulate` / `useSign` / `useFeeTokens` and the Solana
equivalents. They are gone.

## Custody

**Own-origin** (above) is self-custody with no server. **Shared-origin** points your app at an
*operator* that hosts the wallet; your app receives signatures through a popup and **cannot derive key
material** — not by policy, but because WebAuthn will not let an origin request an rpId it does not own.

`<SharedOrigin>` does the async wiring — building the popup-backed connection, constructing the client,
and rendering the provider beneath it:

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

`createSharedOriginConnection` is also exported for hand-wiring, but it takes an injected
`channel: SigningChannel` — `<SharedOrigin>` builds the popup channel for you and imports it
dynamically, so an own-origin-only app never pulls that chunk.

## rpId, RPC, and the rest

`rpId` is an **input to the wallet key** — change it and every user gets a different wallet. Set it
explicitly; the SDK refuses to start without it.

Avok ships **no third-party RPC as a default** (an RPC decides what address a name resolves to, and
therefore where money goes). Pass `rpcUrls` to `createAvokClient`.

See [`@avokjs/core`](https://www.npmjs.com/package/@avokjs/core) for the full client surface — this
package is a thin React layer over it — and its `@avokjs/core/helpers` subpath for balances, chain
metadata and QR device pairing.

## Removing a device's access

Pairing gives the other device **its own key to this wallet**, wrapped under **its own passkey**. The
SDK never keeps `K` at rest — it is derived per gesture and wiped immediately after (`wipeSecrets`), so
a device's lasting access is exactly *its passkey* plus *its encrypted access slot on chain*.

`listAccessSlots()` enumerates them — each carries the `rpId` that enrolled it, so you can tell them
apart — and `removeAccessSlot(slotId, { confirm: true })` deletes one. Both are on `useAccessSlots()`.
On a faithful client this **denies future access**: without its blob there is nothing left for that
passkey to decrypt, so it cannot reconstruct the key on a fresh session.

**Removal is real revocation, and it is bounded.** Both halves matter, so state both to users.

`removeAccessSlot` **destroys the ciphertext on chain** — it does not merely flag the slot inactive.
That is deliberate: a flagged-but-present blob could be read straight back out and decrypted with the
PRF the removed passkey still holds, which would have protected against nothing. Destroying it means a
removed passkey has nothing left to decrypt, so it cannot reconstruct the key on a fresh session. For
the case this exists for — **a device that was lost, and never extracted the key while it worked** —
removal genuinely ends that passkey's access.

What removal cannot do is **un-copy a key that was already taken**. A device compromised *while in use*
could have exfiltrated `K` at any point, and nothing on chain reverses that. The blob was also public
calldata, so it persists in transaction history even after storage is cleared: an adversary who
archived it can still decrypt with the PRF they hold. And because every passkey signs as the same `K`,
any passkey can remove any other.

So the line to draw for users is about *which* thing happened:

> **Lost device that you believe was never used against you — removal is sufficient.**
> **Compromised device, or any doubt — removal is not enough. Move your funds to a new wallet.**

Tell them that *before* they pair, and only pair devices you control.
