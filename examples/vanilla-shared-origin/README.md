# @avok-demo/vanilla-shared-origin

The **framework-free shared-origin (use-only)** showcase for `@avokjs/vanilla`. The wallet's
keys live at an **operator's auth origin**; this app never holds key material — it signs in over
the operator's popup and only receives signatures. Same framework-free stack as
[`vanilla-own-origin`](../vanilla-own-origin) (a tiny `el()` DOM helper + a ~30-line reactive store),
with the shared-origin custody deltas.

Screens: Connect (sign in with the operator) → Home → Send (EVM + Solana, self-pay or fronted)
→ Account (sign, resolve a name, link to the operator's management app, disconnect). There is
**no** create / export / addPasskey / pairing / subname-register here — those
are the operator's (Own-origin) actions.

## Quickstart

Shared-origin needs an operator **auth origin** — the static `@avokjs/auth-origin` pages, hosted anywhere. Nothing runs.

```bash
pnpm install
cp examples/vanilla-shared-origin/.env.example examples/vanilla-shared-origin/.env
# set VITE_AUTH_ORIGIN (and VITE_MANAGEMENT_URL) to your operator, then:
pnpm --filter @avok-demo/vanilla-shared-origin dev
```

- **VITE_AUTH_ORIGIN** — the operator origin where keys live and signing popups run.
- **VITE_MANAGEMENT_URL** — the operator's own-origin wallet app (create / manage / back up there).
- Shared EVM/Solana/fronted/subname vars match `vanilla-own-origin` (Arc testnet `5042002` + Solana
  `devnet` defaults).

## Architecture (framework-free, shared-origin)

- `src/core/{el,store}.ts` — the same DOM helper + reactive store as `vanilla-own-origin`.
- `src/core/app.ts` — the use-only shell: `Ctx.client` is a `UseOnlyAvokClient`, nav is
  Home · Send · Account, and the Connect screen gates the app until there's a session.
- `src/main.ts` — an **async** bootstrap: `createSharedOriginConnection` (which dynamically imports
  `@avokjs/network` for bundle purity) → `createAvokClient`, with a Connecting / error state.
- `src/screens/{Home,Send}.ts` are copied verbatim from `vanilla-own-origin` — they only use the
  use-only verbs (`evm.send` / `solana.send` / `account`). `Connect` and `Account` are shared-origin.

## Per-feature snippets

Trimmed excerpts of the real screens (`src/screens/*.ts`).

### Shared-origin sign-in + async client — `src/main.ts`, `src/screens/Connect.ts`

```ts
import { createAvokClient, createSharedOriginConnection } from "@avokjs/vanilla";

const connection = await createSharedOriginConnection({
  authOrigin: config.authOrigin,     // operator origin — keys live here
  redirectUri: config.redirectUri,
  clientId: config.clientId,
  scopes: config.scopes,
});
const client = createAvokClient({ connection, /* …chain/fee/subname… */, managementUrl: config.managementUrl });

// Connect screen: the sign-in ceremony runs in the operator's popup.
await client.continue();             // only signatures cross back — no key material
```

### EVM + Solana send — `src/screens/Send.ts`

```ts
// Identical to vanilla-own-origin — the use-only client signs via the shared-origin channel. The fee token
// is chain-specific: read the supported ones for the target chain/cluster from the registry
// (client.evm.feeTokens / client.solana.feeTokens) and pass the picked one (null = self-pay).
const receipt = await client.evm.send([call], { chainId, feeToken });          // null = self-pay
const receipt = await client.solana.send(ix, { cluster, feeToken });
```

### Sign a message — `src/screens/Account.ts`

```ts
const evmSig = await client.evm.signMessage({ message });
const { signature: solSig } = await client.solana.signMessage(message);
```

### Subname resolve (resolve-only) — `src/screens/Account.ts`

```ts
// Shared-origin is use-only: look-ups only, no register/mint (that's an operator action).
// The client facade resolves any ENS/SNS name by suffix (.sol→SNS, else→ENS):
const hit = await resolver.resolveForward("alice.eth"); // → { evm?, solana? } | null
```

### Send to a name anywhere — `@avokjs/helpers`

Every address field (Send recipient, name lookup) accepts a raw address **or** any ENS/SNS
name. The reusable `resolveRecipient(resolver, input, rail)` helper resolves a name to the
address you pass into tx args, with clear wrong-rail / not-found errors:

```ts
const rr = await resolveRecipient(resolver, input, rail); // resolver.resolveForward under the hood
if ("error" in rr) show(rr.error);
else ctx.client.evm.send([transferTo(rr.address)]); // rr.resolvedFrom is the name it came from
```

### Management link-out + disconnect — `src/screens/Account.ts`

```ts
window.open(config.managementUrl, "_blank", "noopener"); // manage at the operator's own-origin app
await client.logout();                                   // disconnect this session
```

## Clone into your product

> Needs an operator origin (`VITE_AUTH_ORIGIN`) — run `_nodes` locally or point at a deployed URL.
> For `.test`-domain testing, see [`examples/TESTING.md`](../TESTING.md) and `pnpm demos:domain prepare`.

Depends only on **published** packages — `@avokjs/vanilla` + `@avokjs/contracts` —
plus public `viem` / `@solana/kit` / `@solana-program/system` and its own local `src/`. No
`@avok-demo/*`, no React, no private/workspace-only packages. No dev chrome to delete. To reuse:

1. **Copy the directory** — `examples/vanilla-shared-origin/` → your app's location.
2. **Edit config** — `src/config.ts` reads `VITE_*`; set `VITE_AUTH_ORIGIN` / `VITE_MANAGEMENT_URL`
   to your operator, plus the shared chain / fee / subname vars.
3. **Reskin** — swap the brand values in `src/theme/tokens.css` and `src/ui/ui.css`, then delete
   `src/features.ts` (the parity-harness manifest — no runtime purpose).
4. **Install** — `pnpm install` pulls the published `@avokjs/vanilla` + `@avokjs/contracts`.
