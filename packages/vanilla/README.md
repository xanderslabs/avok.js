# @avokjs/vanilla

Avok for the browser, framework-free. **The passkey *is* the wallet.**

`K = HKDF(PRF(credential, rpId))` — the key is derived from the passkey on every use, then discarded.
It is stored nowhere: not on a server, not in `localStorage`, not in the wallet. There is no seed
phrase to lose and no private key to leak, because there is no private key at rest.

```bash
npm i @avokjs/vanilla
```

## Two custody models

**Own-origin** — self-custody, no server. The wallet lives in your app; a passkey opens it.

```ts
import { createAvokClient, createOwnOriginConnection } from "@avokjs/vanilla";

const connection = createOwnOriginConnection({
  rpId: "example.com",   // REQUIRED and explicit — see "Choosing your rpId"
});

const client = createAvokClient({ connection });

await connection.create({ nickname: "Main" });   // one passkey gesture
const account = connection.account();            // { evm: { address }, solana: { address } }
```

**Shared-origin** — your users' wallets live with an *operator* (see `@avokjs/auth-origin`), and
your app receives signatures through a popup. Your app never touches key material; it is structurally
incapable of deriving it.

```ts
import { createSharedOriginConnection } from "@avokjs/vanilla";

const connection = await createSharedOriginConnection({
  authOrigin: "https://wallet.example.com",
  redirectUri: "https://app.example.com/callback",
});

await connection.continue();   // popup → passkey → signed in
```

## Sending

```ts
// EVM
const receipt = await client.evm.send({ chainId: 8453, to: "vitalik.eth", token: USDC, amount: 1_000_000n });
const final = await client.evm.wait(receipt);   // ← "confirmed" comes from here, and ONLY from here

// Solana
const ix = await client.solana.buildSplTransfer({ mint: USDC_MINT, to: "toly.sol", amount: 1_000_000n, cluster: "mainnet" });
const solReceipt = await client.solana.send(ix, { cluster: "mainnet" });
const solFinal = await client.solana.wait(solReceipt);
```

**`send()` is not a confirmation, and `wait()` is not optional.** `send()` returns as soon as the
transaction is handed off — `"submitted"` on self-pay (broadcast, not mined) and `"pending"` on
sponsored, where the receipt's `id` is the *relayer's intent id* and there is no signature yet at all.
Neither status means the money moved, and neither can be linked to an explorer. `wait()` polls until
the transaction actually lands and is **the only producer of `"confirmed"`**. Treat `send()` as done
and you will report a transaction that never landed as a success. Both rails work the same way.

Names resolve through ENS and SNS. **Whoever answers that lookup decides where the money goes**, which
is why Avok ships no third-party RPC as a default — see below.

## RPC endpoints

An RPC answers *"what address does `vitalik.eth` resolve to?"*, so a dishonest one redirects funds. You
choose who to trust:

```ts
createAvokClient({
  connection,
  rpcUrls: {
    solana: { mainnet: "https://your-provider…" },
    evm: { 8453: "https://your-provider…" },
  },
});
```

Unset chains fall back to a **public** endpoint — fine for development, rate-limited and SLA-less for
production. The same field accepts a paid provider, any proxy you host, or a URL your end user
pastes: interchangeable.

## Choosing your rpId

`rpId` is an **input to the wallet key**. Change it and every user gets a *different wallet*. Pick a
domain you will never give up, set it explicitly, and never derive it from a URL — the SDK refuses to
start without it, because an inferred rpId is a wallet-drain defect.

## Batteries

`@avokjs/helpers` has balances, chain metadata, recipient resolution, explorer links, and QR
device pairing. This package is headless on purpose.

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
