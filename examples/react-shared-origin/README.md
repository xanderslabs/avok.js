# @avok-demo/react-shared-origin

The canonical **Shared-origin** (use-only) reference app for `@avokjs/react`. The wallet's
keys live at the **operator's auth origin**; this app never holds key material — it signs in
via a shared-origin popup and only receives signatures back. It's the sibling of
[`react-own-origin`](../react-own-origin) (self-custody); same screen kit, honest custody split.

Screens: Connect (continue via the operator's popup — **no create / import**) → Home → Send
(EVM + Solana, self-pay or sponsored — signed over the shared-origin channel) → Account (sign,
subname **resolve**, disconnect, link out to the operator for management).

Because keys aren't here, the use-only surface has **no** create / export / addPasskey /
pairing / subname-register — those are own-origin/operator actions and happen at the operator's
own wallet app (`VITE_MANAGEMENT_URL`).

## Quickstart

This app needs an operator **auth origin** to sign against — the static `@avokjs/auth-origin`
pages, built with the operator's config and hosted anywhere. Nothing runs: they are two HTML files.
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
  (the operator's own-origin app). Sponsored sends ("sponsored") and subname resolve are opt-in via
  the relevant `VITE_*` vars.

## Per-feature snippets

These are trimmed excerpts of the real screens (`src/screens/*.tsx`) — see those files for
the full component.

### Connect — continue via the operator's popup — `src/screens/Connect.tsx`

Shared-origin has no create/import. `useContinue()` runs the ceremony in the operator's popup; no
key material crosses the boundary. "New here?" links out to the operator's own app.

```tsx
import { useContinue } from "@avokjs/react";

const { continue: continueAccount, pending, error } = useContinue();

await continueAccount(); // opens the operator popup; returns a session, keys stay at the operator
```

The shared-origin client itself is built asynchronously (it dynamically imports
`@avokjs/shared-origin`), so `useSharedOriginClient()` exposes loading/error while the auth-origin
channel wires up — see `src/useSharedOriginClient.ts`:

```ts
import { createAvokClient, createSharedOriginConnection } from "@avokjs/react";

const connection = await createSharedOriginConnection({
  authOrigin: config.authOrigin,
  redirectUri: config.redirectUri,
  clientId: config.clientId,
  scopes: config.scopes,
});
const client = createAvokClient({ connection, /* chain/fee/subname config */ managementUrl: config.managementUrl });
```

### EVM send — self-pay + sponsored — `src/screens/Send.tsx`

The Send screen is identical to react-own-origin's — the send hooks work the same on the use-only
client; signatures just route through the shared-origin channel.

```tsx
import { useSimulate, useSend } from "@avokjs/react";
import { encodeFunctionData, erc20Abi } from "viem";

const { simulate: evmSimulate } = useSimulate();
const { send: evmSend } = useSend();

const call = {
  to: evmToken.address,
  value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amountBase] }),
};
// Fee tokens are chain-specific — read the supported ones for THIS chain from the registry and let
// the user pick. `useFeeTokens().feeTokens(chainId)` mirrors `useSolanaFeeTokens` for the EVM side.
const { feeTokens } = useFeeTokens();
const selectedFeeToken = effectiveFeeMode === "sponsored" ? (feeTokens(chain.id)[feeTokenIdx]?.address ?? null) : null;
const sim = await evmSimulate([call], { chainId: chain.id, feeToken: selectedFeeToken }); // null = self-pay
const receipt = await evmSend(sim, { chainId: chain.id, feeToken: selectedFeeToken });
```

`feeToken: null` pays gas from the account's own balance (self-pay); passing a fee-token **address
supported on that chain** (with `VITE_PAYMASTER_URL` set) sponsors the send (sponsored). The address is
chain-specific, so it comes from `client.evm.feeTokens(chainId)`, never from a global env var.

### Solana send — `src/screens/Send.tsx`

```tsx
import { useSolanaSimulate, useSolanaSend } from "@avokjs/react";
import { getTransferSolInstruction } from "@solana-program/system";

const { simulate: solSimulate } = useSolanaSimulate();
const { send: solSend } = useSolanaSend();

const ix = [
  getTransferSolInstruction({
    source: { address: account.solana.address } as never,
    destination: to as never,
    amount: amountBase,
  }),
];
// Same pattern on Solana: the fee MINT is cluster-specific — read it from the registry and pick.
const { feeTokens: solanaFeeTokens } = useSolanaFeeTokens();
const selectedFeeMint = effectiveFeeMode === "sponsored" ? (solanaFeeTokens(config.solanaCluster)[feeTokenIdx]?.mint ?? null) : null;
const sim = await solSimulate(ix, { cluster: config.solanaCluster, feeToken: selectedFeeMint });
const receipt = await solSend(sim, { cluster: config.solanaCluster, feeToken: selectedFeeMint });
```

### Sign a message — `src/screens/Account.tsx`

```tsx
import { useSign, useSolanaSign } from "@avokjs/react";

const { signMessage: signEvm } = useSign();
const { signMessage: signSolana } = useSolanaSign();

const evmSig = await signEvm({ message });
const { signature: solSig } = await signSolana(message);
```

### Subname — resolve only — `src/screens/Account.tsx`

Shared-origin is use-only, so subname is **resolve-only** (registration is an own-origin/operator
action). Forward resolution (name → address) is on the client facade — `subname.resolveName`
dispatches any name by suffix (`.sol` → SNS, else → ENS) and needs no mint config:

```tsx
const client = useAvok();
const hit = await resolver.resolveForward("alice.eth"); // → { evm?, solana? } | null
```

### Send to a name anywhere — `@avokjs/helpers`

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

> Needs an operator origin (`VITE_AUTH_ORIGIN`) — run `_nodes` locally or point at a deployed URL.
> For `.test`-domain testing, see [`examples/TESTING.md`](../TESTING.md) and `pnpm demos:domain prepare`.

This app depends only on **published** packages — the `@avokjs/react` facade and
`@avokjs/helpers` (balances, chain metadata + names, recipient resolution, explorers) — plus the public third-party libs `viem`,
`@solana/kit`, `@solana-program/system`, and its own local `src/`. No `@avok-demo/*` and no
private/workspace-only packages. To reuse it as a shared-origin (use-only) base for a real product:

1. **Copy the directory** — `examples/react-shared-origin/` → your app's location.
2. **Edit config** — `src/config.ts` reads `VITE_*` env vars; update `.env` with your operator's
   `VITE_AUTH_ORIGIN` / `VITE_MANAGEMENT_URL` (the shared-origin seam) plus the
   paymaster/relayer URLs. Chains are picked per-call and fee tokens come from the registry, not env.
3. **Reskin** — swap the brand values in `src/theme/tokens.ts` (`palette`, `radius`, `space`,
   `font`, `type`), then **delete `src/features.ts`** — it's the parity-harness manifest used
   only by this monorepo's `@avok-demo/coverage` package and has no runtime purpose.
4. **Install** — `pnpm install` in your app; it pulls the published `@avokjs/react` and
   `@avokjs/contracts` packages (plus `viem`, `@solana/kit`, `@solana-program/system` for
   chain interaction) — not `workspace:*` links.
