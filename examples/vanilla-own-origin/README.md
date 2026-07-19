# @avok-demo/vanilla-own-origin

The hosted **marketing bird**: a **framework-free** (no React/Vue/etc.) **Own-origin**
(self-custody) showcase for `@avokjs/core` — WebAuthn passkeys held in-browser, no
custodian, no server-side account. Clean, simple, and cloneable: just TypeScript + the
published SDK + a small CSS-variable design kit. One family with the React demos, a distinct
vanilla expression.

Screens: Onboard (create / log in / set up this device) → Home → Send (EVM + Solana, self-pay or
sponsored; recipient accepts an ENS/SNS name) → Account (sign, export) → Access (the trust surface) →
Device (add an access slot, SAS pairing) — the same own-origin surface as `react-own-origin`, rendered
with a tiny `el()` DOM helper + a ~30-line reactive store, no framework.

## Quickstart

```bash
pnpm install
cp examples/vanilla-own-origin/.env.example examples/vanilla-own-origin/.env
pnpm --filter @avok-demo/vanilla-own-origin dev
```

`.env.example` ships with sane testnet defaults — nothing is required to run the app:

- **EVM**: Arc testnet, chain id `5042002` (Circle's stablechain; native gas is USDC).
- **Solana**: `devnet` cluster.
- Sponsored sends (the "sponsored" rail) are opt-in — set the relevant `VITE_*` vars (paymaster /
  bundler / Kora) in `.env`. Name **resolution** (`alice.eth` / `alice.sol`) is always on and needs
  no config; Avok does no name registration.

## Architecture (framework-free)

- `src/core/el.ts` — a tiny hyperscript DOM helper (`el(tag, props, ...children)` + `svg()`).
- `src/core/store.ts` — a ~30-line reactive store holding app-level state (nav, account).
- `src/core/app.ts` — the shell/router: Onboard when there's no account, else the primary nav
  (Home · Send · Account) + the active screen. Each screen is a `render(ctx): HTMLElement`
  function that owns its own local state via a closure `set()` re-render.
- `src/ui/*` — a CSS-class UI kit (`ui.css` + factory functions) reading design tokens from
  `src/theme/tokens.css` (CSS custom properties; dark mode via `prefers-color-scheme`).
- `@avokjs/core/helpers` — the shared logic this demo imports rather than owning: balances,
  chain metadata + display names, recipient resolution, explorer builders, amount formatting, the
  tx-status state machine, error classification, and the device-pairing ceremony driver. The QR
  pairing transport comes from `@avokjs/core/qr`.
- `src/pairing/*` — the SAS-gated pairing controllers + the el() QR ceremony UI over that driver.

## Per-feature snippets

Trimmed excerpts of the real screens (`src/screens/*.ts`) — see those files for the full flow.
Unlike the React demos, this app calls the raw `@avokjs/core` client verbs directly.

### Client init — `src/main.ts`

```ts
import { createAvokClient, createOwnOriginConnection } from "@avokjs/core";
import { config } from "./config.js";

const connection = createOwnOriginConnection({ rpId: config.rpId });
const client = createAvokClient({
  connection,
  defaultChainId: config.defaultChainId,
  paymasterUrl: config.paymasterUrl,
  defaultSolanaCluster: config.solanaCluster,
  koraUrl: config.koraUrl,
});
```

### Create / log in — `src/screens/Onboard.ts`

```ts
const account = await client.create(); // new passkey + account
const account = await client.login();  // existing passkey on this device
```

There is no import: the wallet key is derived from a WebAuthn PRF evaluation, not a seed you can
type in, so there's nothing to import from.

### EVM send — self-pay + sponsored — `src/screens/Send.ts`

```ts
import { encodeFunctionData, erc20Abi } from "viem";

const call = {
  to: evmToken.address,
  value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amountBase] }),
};
// Fee tokens are chain-specific — read the supported ones for THIS chain from the client and let
// the user pick. `client.evm.feeTokens(chainId)` is the EVM mirror of `client.solana.feeTokens`.
const selectedFeeToken = feeMode === "sponsored" ? (client.evm.feeTokens(chain.id)[feeTokenIdx]?.address ?? null) : null;
const sim = await client.evm.simulate([call], { chainId: chain.id, feeToken: selectedFeeToken }); // null = self-pay
const receipt = await client.evm.send(sim, { chainId: chain.id, feeToken: selectedFeeToken });
```

`feeToken: null` pays gas from the account's own balance (self-pay); passing a fee-token **address
supported on that chain** (with `VITE_PAYMASTER_URL` set) sponsors the send (sponsored). The address is
chain-specific, so it comes from `client.evm.feeTokens(chainId)`, never from a global env var. The
demo drives a `pending → confirmed | failed` status (`@avokjs/core/helpers`) and links the receipt to
the chain's explorer.

### Solana send — `src/screens/Send.ts`

```ts
import { getTransferSolInstruction } from "@solana-program/system";

const ix = [
  getTransferSolInstruction({
    source: { address: account.solana.address } as never,
    destination: to as never,
    amount: amountBase,
  }),
];
// Same pattern on Solana: the fee MINT is cluster-specific — read it from the client and pick.
const selectedFeeMint = feeMode === "sponsored" ? (client.solana.feeTokens(config.solanaCluster)[feeTokenIdx]?.mint ?? null) : null;
const sim = await client.solana.simulate(ix, { cluster: config.solanaCluster, feeToken: selectedFeeMint });
const receipt = await client.solana.send(sim, { cluster: config.solanaCluster, feeToken: selectedFeeMint });
```

### Sign a message — `src/screens/Account.ts`

```ts
const evmSig = await client.evm.signMessage({ message });
const { signature: solSig } = await client.solana.signMessage(message);
```

### Access slots + export — `src/screens/Account.ts`, `src/screens/Access.ts`

```ts
const count = await client.accessSlotCount();  // chain-verified: how many passkeys can reach this wallet
const evmKey = await client.exportEvmKey();    // danger-gated ROOT key (restores the whole wallet, both chains)
const solanaKey = await client.exportSolanaKey(); // the leaf key
```

A primary passkey IS the wallet: it derives its key from PRF on every login and stores nothing, so
it has nothing to back up. `accessSlotCount()` reports how many passkeys can reach the wallet key
(each enrolled via `client.enrollAccessSlot()`, on the Device screen); the full roster is on the
Access screen (`client.listAccessSlots()`). Export never returns a recovery phrase — `exportEvmKey`
is the root key (alone it restores both chains, VISION §5) and `exportSolanaKey` is the leaf.

### Send to a name anywhere — `@avokjs/core/helpers`

Every address field (Send recipient, name lookup) accepts a raw address **or** any ENS/SNS
name. The reusable `resolveRecipient(resolver, input, rail)` helper resolves a name to the
address you pass into tx args, with clear wrong-rail / not-found errors:

```ts
const rr = await resolveRecipient(resolver, input, rail); // resolver.resolveForward under the hood
if ("error" in rr) show(rr.error);
else client.evm.simulate([transferTo(rr.address)]); // rr.resolvedFrom is the name it came from
```

### Add an access slot + cross-device pairing — `src/screens/Device.ts`, `src/pairing/controller.ts`

`client.enrollAccessSlot()` enrols a second credential on the SAME device (one funded transaction).
Cross-device pairing provisions the wallet onto a DIFFERENT device via `enrollAccessSlot.viaPairing`,
which is two-part: `.holder` runs on the existing device (it holds the wallet and pays), `.enroller`
on the new one.

```ts
const { passkeyCount } = await client.enrollAccessSlot(); // new access slot on this device
```

Pairing another device is a SAS-confirmed handshake — the writes that assert `sasConfirmed: true` only
fire after the user compares the code on both devices (enforced by `src/pairing/controller.ts`); the
wallet key never travels (an encrypted blob does), and the holder pays for the on-chain write:

```ts
const pairing = client.enrollAccessSlot.viaPairing;

// new device (B) — enroller: begin → receive ack → (SAS) → enroll
const { qr: requestQr } = await pairing.enroller.begin();
const { sas } = await pairing.enroller.receiveAck(ackCode);
const { qr: wrapQr } = await pairing.enroller.enroll({ sasConfirmed: true });

// existing device (A) — holder: authorize → (SAS) → complete (writes the access slot, and pays)
const { qr: ackQr, sas } = await pairing.holder.authorize({ qr: requestCode });
await pairing.holder.complete({ qr: wrapQr, sasConfirmed: true });
```

## Clone into your product

> Runs **standalone** — no operator needed (passkey in-browser). For `.test`-domain / HTTPS
> testing, see [`examples/TESTING.md`](../TESTING.md) and `pnpm demos:domain prepare`.

This app depends only on **published** packages — the `@avokjs/core` facade and
`@avokjs/core/helpers` (balances, chain metadata + names, recipient resolution, explorers) — plus the public third-party libs `viem`,
`@solana/kit`, `@solana-program/system`, and its own local `src/`. No `@avok-demo/*`, no React,
no private/workspace-only packages. There is **no dev chrome to delete** — it's clean to begin
with. To reuse it:

1. **Copy the directory** — `examples/vanilla-own-origin/` → your app's location.
2. **Edit config** — `src/config.ts` reads `VITE_*` env vars; update `.env` (VITE_RP_ID, the anchor chain
   NAME, paymaster / bundler / Kora URLs for the sponsored rail) for your deployment. Chain
   details and fee tokens come from the registry, not env.
3. **Reskin** — swap the brand values in `src/theme/tokens.css` (the `--*` custom properties)
   and `src/ui/ui.css`, then **delete `src/features.ts`** — it's the parity-harness manifest
   used only by this monorepo's `@avok-demo/coverage` package and has no runtime purpose.
4. **Install** — `pnpm install` in your app; it pulls the published `@avokjs/core` and
   `@avokjs/contracts` packages (plus `viem`, `@solana/kit`, `@solana-program/system`) —
   not `workspace:*` links.
