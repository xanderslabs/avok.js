# @avokjs/react

React bindings for Avok. **The passkey *is* the wallet** — `K = HKDF(PRF(credential, rpId))`, derived
on every use and stored nowhere.

```bash
npm i @avokjs/react react
```

```tsx
import { AvokProvider, createAvokClient, createOwnOriginConnection, useAccount, useSend } from "@avokjs/react";

const client = createAvokClient({
  connection: createOwnOriginConnection({ rpId: "example.com" }), // explicit — see below
});

function App() {
  return (
    <AvokProvider client={client}>
      <Wallet />
    </AvokProvider>
  );
}

function Wallet() {
  const { account } = useAccount();
  const { send, pending } = useSend();

  if (!account) return <Connect />;

  return (
    <button
      disabled={pending}
      onClick={() => send({ chainId: 8453, to: "vitalik.eth", token: USDC, amount: 1_000_000n })}
    >
      Send 1 USDC
    </button>
  );
}
```

## Hooks

| | |
|---|---|
| `useAccount` `useCreate` `useContinue` `useLogout` | account lifecycle |
| `useSend` `useSimulate` `useSign` `useFeeTokens` | EVM |
| `useSolanaSend` `useSolanaSimulate` `useSolanaSign` `useSolanaFeeTokens` | Solana |
| `useSelfCustody` `useAvok` | custody introspection, raw client |

Every hook returns `{ pending, error }` alongside its action, so a failed passkey gesture or a rejected
signature surfaces where you render it — not as an unhandled rejection.

## Custody

**Own-origin** (above) is self-custody with no server. **Shared-origin** points your app at an *operator* that
hosts the wallet; your app receives signatures through a popup and **cannot derive key material** — not
by policy, but because WebAuthn will not let an origin request an rpId it does not own.

```tsx
const connection = await createSharedOriginConnection({
  authOrigin: "https://wallet.example.com",
  redirectUri: "https://app.example.com/callback",
});
```

## rpId, RPC, and the rest

`rpId` is an **input to the wallet key** — change it and every user gets a different wallet. Set it
explicitly; the SDK refuses to start without it.

Avok ships **no third-party RPC as a default** (an RPC decides what address a name resolves to, and
therefore where money goes). Pass `rpcUrls` to `createAvokClient`.

See [`@avokjs/vanilla`](https://www.npmjs.com/package/@avokjs/vanilla) for the full client
surface — this package is a thin React layer over it — and `@avokjs/helpers` for balances, chain
metadata and QR device pairing.

## Removing a device's access

Pairing gives the other device **its own key to this wallet**, wrapped under **its own passkey**. The
SDK never keeps `K` at rest — it is derived per gesture and wiped immediately after (`wipeSecrets`), so
a device's lasting access is exactly *its passkey* plus *its encrypted access slot on chain*.

`listAccessSlotsWithDomains()` enumerates the access slots — each with the domain that enrolled it, so
you can tell them apart — and `removeAccessSlot(slotId, { confirm: true })` deletes one. On a faithful
client this **denies future access**: without its blob there is nothing left for that passkey to
decrypt, so it cannot reconstruct the key on a fresh session.

**Removal is housekeeping, not revocation**, and no UI may present it as a security control. It cannot
*guarantee* the key was never kept — a device compromised or running a modified ceremony *while in use*
could have exfiltrated `K` live, and no on-chain action un-copies it. The blob was public calldata and
stays in chain history forever; and because every passkey signs as the same `K`, any passkey can remove
any other. So:

> **If a paired device is lost or compromised, removal is not enough — move your funds to a new wallet.**

Tell your users that *before* they pair, and only pair devices you control.
