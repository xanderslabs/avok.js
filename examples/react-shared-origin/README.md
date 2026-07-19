# @avok-demo/react-shared-origin

The canonical **Shared-origin** (use-only) reference app for `@avokjs/react`. The wallet's
keys live at the **operator's auth origin**; this app never holds key material — it signs in
via a shared-origin popup and only receives signatures back. It's the sibling of
[`react-own-origin`](../react-own-origin) (self-custody); same screen kit, honest custody split.

Screens: Connect (log in via the operator's popup — **no create / import**) → Home → Send
(EVM + Solana, self-pay or sponsored — signed over the shared-origin channel) → Account (sign via the
standard provider surfaces, name **resolve**, disconnect, link out to the operator for management).

Because keys aren't here, the use-only surface has **no** create / export / access-slot enrollment /
pairing / name registration — those are own-origin/operator actions and happen at the operator's
own wallet app (`VITE_MANAGEMENT_URL`).

## Quickstart

This app needs an operator **auth origin** to sign against — one static, CSP-safe page built from the
`@avokjs/core/auth-popup` mountable (`mountAuthPopup()` / `<AuthPopup>`) with the operator's config via
`pnpm emit:auth-page`, and hosted anywhere. Nothing runs: it is a single inlined `index.html`.
(The old `examples/_nodes` harness was deleted in #4 along with the relayers.)

```bash
pnpm install
cp examples/react-shared-origin/.env.example examples/react-shared-origin/.env
# set VITE_AUTH_ORIGIN to the operator's auth origin (runs the shared-origin sign popup)
# set VITE_MANAGEMENT_URL to the operator's own-origin wallet app (create / manage / back up)
pnpm --filter @avok-demo/react-shared-origin dev
```

`.env.example` ships with sane testnet defaults for the chain layer:

- **EVM**: Arc testnet, chain id `5042002` (Circle's stablechain; native gas is USDC).
- **Solana**: `devnet` cluster.
- **Shared-origin**: `VITE_AUTH_ORIGIN` (required — the operator origin) and `VITE_MANAGEMENT_URL`
  (the operator's own-origin app). Sponsored sends (the "sponsored" rail) are opt-in via the relevant
  `VITE_*` vars; name **resolution** is always on and needs no config.

## Per-feature snippets

These are trimmed excerpts of the real screens (`src/screens/*.tsx`) — see those files for
the full component.

### Connect — log in via the operator's popup — `src/screens/Connect.tsx`

Shared-origin has no create/import. The WalletConnect-style trigger `useAvokConnect()` runs the
ceremony in the operator's popup; no key material crosses the boundary. "New here?" links out to the
operator's own app. (The demo drives `client.login()` off `useAvok()` directly; `useAvokConnect()` is
the same thing wrapped as a hook with `isPending`/`error`.)

```tsx
import { useAvokConnect } from "@avokjs/react";

const { connect, isPending, error, isConnected } = useAvokConnect();

await connect(); // opens the operator popup; returns the account, keys stay at the operator
```

The shared-origin client is built asynchronously (it dynamically imports `@avokjs/core/channel` for
bundle purity). Wrap your app in `<SharedOrigin>` and it does that wiring for you:

```tsx
import { SharedOrigin } from "@avokjs/react";

<SharedOrigin auth={config.authOrigin} managementUrl={config.managementUrl} fallback={<Spinner />}>
  <App />
</SharedOrigin>;
```

Or build it by hand (what `src/useSharedOriginClient.ts` does) — note there is no OIDC config
(`redirectUri` / `clientId` / `scopes` were removed in #8; the popup postMessages the account back):

```ts
import { createAvokClient, createSharedOriginConnection } from "@avokjs/react";

const connection = await createSharedOriginConnection({ authOrigin: config.authOrigin });
const client = createAvokClient({ connection, managementUrl: config.managementUrl /* + paymaster/bundler/kora */ });
```

### EVM send — self-pay + sponsored — `src/screens/Send.tsx`

The Send screen is identical to react-own-origin's — drive the use-only client's `evm` / `solana`
namespaces off `useAvok()`; the signatures just route through the shared-origin popup instead of
in-page. (Sending is never a framework hook, VISION §6.)

```tsx
import { useAvok } from "@avokjs/react";
import { encodeFunctionData, erc20Abi } from "viem";

const client = useAvok();

const call = {
  to: evmToken.address,
  value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amountBase] }),
};
// Fee tokens are chain-specific — read the supported ones for THIS chain from the client and pick.
const feeTokens = client.evm.feeTokens(chain.id);
const selectedFeeToken = feeMode === "sponsored" ? (feeTokens[feeTokenIdx]?.address ?? null) : null;
const sim = await client.evm.simulate([call], { chainId: chain.id, feeToken: selectedFeeToken }); // null = self-pay
const receipt = await client.evm.send(sim, { chainId: chain.id, feeToken: selectedFeeToken });
```

`feeToken: null` pays gas from the account's own balance (self-pay); passing a fee-token **address
supported on that chain** (with `VITE_PAYMASTER_URL` set) sponsors the send (sponsored). The address is
chain-specific, so it comes from `client.evm.feeTokens(chainId)`, never from a global env var.

### Solana send — `src/screens/Send.tsx`

```tsx
const client = useAvok();
import { getTransferSolInstruction } from "@solana-program/system";

const ix = [
  getTransferSolInstruction({
    source: { address: account.solana.address } as never,
    destination: to as never,
    amount: amountBase,
  }),
];
// Same pattern on Solana: the fee MINT is cluster-specific — read it from the client and pick.
const feeTokens = client.solana.feeTokens(config.solanaCluster);
const selectedFeeMint = feeMode === "sponsored" ? (feeTokens[feeTokenIdx]?.mint ?? null) : null;
const sim = await client.solana.simulate(ix, { cluster: config.solanaCluster, feeToken: selectedFeeMint });
const receipt = await client.solana.send(sim, { cluster: config.solanaCluster, feeToken: selectedFeeMint });
```

### Sign a message — through the STANDARD provider surfaces — `src/screens/Account.tsx`

A shared-origin dapp signs the way any dapp does — **never an Avok-specific verb** (VISION §6, Surface
1): EVM through the announced EIP-1193 provider (`personal_sign`), Solana through the Wallet Standard
(`solana:signMessage`) discovered off the page's wallet registry, exactly as `@solana/wallet-adapter`
would find it. The wallet's popup shows the message and signs; zero Avok imports in the signing path.

```tsx
import { getWallets } from "@wallet-standard/app";

// EVM — the announced EIP-1193 provider (discover via EIP-6963 / window.ethereum):
const evmSig = await provider.request({ method: "personal_sign", params: [message, account.evm.address] });

// Solana — the Wallet Standard feature, found the standard way:
const wallet = getWallets().get().find((w) => w.name === "Avok" && "solana:signMessage" in w.features);
const [{ signature }] = await wallet.features["solana:signMessage"].signMessage({
  account: wallet.accounts[0],
  message: new TextEncoder().encode(message),
});
```

### Names — resolve only — `src/screens/Account.tsx`

Avok does no name registration anywhere — only **resolution**, which is read-only and needs no config.
The resolver (`@avokjs/core/helpers`) dispatches any name by suffix (`.sol` → SNS, else → ENS):

```tsx
import { resolver } from "../resolver.js"; // built from @avokjs/core/helpers' createNameResolver
const hit = await resolver.resolveForward("alice.eth"); // → { evm?, solana? } | null
```

### Send to a name anywhere — `@avokjs/core/helpers`

Every address field (Send recipient, name lookup) accepts a raw address **or** any ENS/SNS
name. The reusable `resolveRecipient(resolver, input, rail)` helper resolves a name to the
address you pass into tx args, with clear wrong-rail / not-found errors:

```tsx
const rr = await resolveRecipient(resolver, input, rail); // resolver.resolveForward under the hood
if ("error" in rr) show(rr.error);
else simulate([transferTo(rr.address)]); // rr.resolvedFrom is the name it came from
```

### Wallet management — at the operator, not here — `src/screens/Account.tsx`

```tsx
// Managed by <operator> — export, backup, and device management happen at the operator's app.
window.open(config.managementUrl, "_blank", "noopener");
```

## Clone into your product

> Needs an operator origin (`VITE_AUTH_ORIGIN`) — the operator's hosted auth-popup page (built with
> `pnpm emit:auth-page`), point at a deployed URL. For `.test`-domain testing, see
> [`examples/TESTING.md`](../TESTING.md) and `pnpm demos:domain prepare`.

This app depends only on **published** packages — the `@avokjs/react` facade and
`@avokjs/core/helpers` (balances, chain metadata + names, recipient resolution, explorers) — plus the public third-party libs `viem`,
`@solana/kit`, `@solana-program/system`, and its own local `src/`. No `@avok-demo/*` and no
private/workspace-only packages. To reuse it as a shared-origin (use-only) base for a real product:

1. **Copy the directory** — `examples/react-shared-origin/` → your app's location.
2. **Edit config** — `src/config.ts` reads `VITE_*` env vars; update `.env` with your operator's
   `VITE_AUTH_ORIGIN` / `VITE_MANAGEMENT_URL` (the shared-origin seam) plus the
   paymaster / bundler / Kora URLs. Chains are picked per-call and fee tokens come from the registry, not env.
3. **Reskin** — swap the brand values in `src/theme/tokens.ts` (`palette`, `radius`, `space`,
   `font`, `type`), then **delete `src/features.ts`** — it's the parity-harness manifest used
   only by this monorepo's `@avok-demo/coverage` package and has no runtime purpose.
4. **Install** — `pnpm install` in your app; it pulls the published `@avokjs/react` and
   `@avokjs/contracts` packages (plus `viem`, `@solana/kit`, `@solana-program/system` for
   chain interaction) — not `workspace:*` links.
