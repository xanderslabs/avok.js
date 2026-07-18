# @avok-demo/vanilla-own-origin

The hosted **marketing bird**: a **framework-free** (no React/Vue/etc.) **Own-origin**
(self-custody) showcase for `@avokjs/core` — WebAuthn passkeys held in-browser, no
custodian, no server-side account. Clean, simple, and cloneable: just TypeScript + the
published SDK + a small CSS-variable design kit. One family with the React demos, a distinct
vanilla expression.

Screens: Onboard (create / continue / set up this device) → Home → Send (EVM + Solana, self-pay or
sponsored) → Account (sign, export) → Subname (register / resolve) → Device
(add a passkey, SAS pairing) — the same own-origin surface as `react-own-origin`, rendered with a tiny
`el()` DOM helper + a ~30-line reactive store, no framework.

## Quickstart

```bash
pnpm install
cp examples/vanilla-own-origin/.env.example examples/vanilla-own-origin/.env
pnpm --filter @avok-demo/vanilla-own-origin dev
```

`.env.example` ships with sane testnet defaults — nothing is required to run the app:

- **EVM**: Arc testnet, chain id `5042002` (Circle's stablechain; native gas is USDC).
- **Solana**: `devnet` cluster.
- Sponsored sends ("sponsored") and Subname (ENS registrar/parent) are opt-in — set the
  relevant `VITE_*` vars in `.env` to enable them.

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

### Create / continue — `src/screens/Onboard.ts`

```ts
const account = await client.create();   // new passkey + account
const account = await client.continue(); // existing passkey on this device
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
// Fee tokens are chain-specific — read the supported ones for THIS chain from the registry and let
// the user pick. `client.evm.feeTokens(chainId)` is the EVM mirror of `client.solana.feeTokens`.
const selectedFeeToken = feeMode === "sponsored" ? (client.evm.feeTokens(chain.id)[feeTokenIdx]?.address ?? null) : null;
const receipt = await client.evm.send([call], { chainId: chain.id, feeToken: selectedFeeToken }); // null = self-pay
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
// Same pattern on Solana: the fee MINT is cluster-specific — read it from the registry and pick.
const selectedFeeMint = feeMode === "sponsored" ? (client.solana.feeTokens(config.solanaCluster)[feeTokenIdx]?.mint ?? null) : null;
const receipt = await client.solana.send(ix, { cluster: config.solanaCluster, feeToken: selectedFeeMint });
```

### Sign a message — `src/screens/Account.ts`

```ts
const evmSig = await client.evm.signMessage({ message });
const { signature: solSig } = await client.solana.signMessage(message);
```

### Extra devices + export — `src/screens/Account.ts`

```ts
const hasExtraDevice = await client.read.backupStatus(); // is a SECONDARY device's slot on chain?
const { evm, solana } = await client.export();            // danger-gated: two raw private keys
```

A primary passkey IS the wallet: it derives its key from PRF on every login and stores nothing,
so it has nothing to back up. `backupStatus()` reports whether a *secondary* device has been
enrolled (via `client.addPasskey()`, on the Device screen) — not whether this wallet is safe.
`export()` never returns a recovery phrase; it returns the two raw private keys directly.

### Send to a name anywhere — `@avokjs/core/helpers`

Every address field (Send recipient, name lookup) accepts a raw address **or** any ENS/SNS
name. The reusable `resolveRecipient(resolver, input, rail)` helper resolves a name to the
address you pass into tx args, with clear wrong-rail / not-found errors:

```ts
const rr = await resolveRecipient(resolver, input, rail); // resolver.resolveForward under the hood
if ("error" in rr) show(rr.error);
else client.evm.send([transferTo(rr.address)]); // rr.resolvedFrom is the name it came from
```

### Add a passkey + cross-device pairing — `src/screens/Device.ts`, `src/pairing/controller.ts`

`addPasskey` enrols a second credential on the SAME device (one funded transaction). Cross-device
pairing provisions the wallet onto a DIFFERENT device and is two-part: `pairing.exportToDevice.*`
runs on the existing device, `pairing.importToDevice.*` on the new one.

```ts
const { passkeyCount } = await client.addPasskey(); // enroll a new passkey on this device
```

Pairing another device is a SAS-confirmed handshake — `grant()`/`complete()` only fire after an
explicit user confirmation, never automatically (enforced by `src/pairing/controller.ts`):

```ts
// existing device (A) — exportToDevice
const { qr: ackQr, sas } = await client.pairing.exportToDevice.authorize({ qr: requestCode });
// user compares `sas` on both devices, then:
const { qr: grantQr } = await client.pairing.exportToDevice.grant({ sasConfirmed: true });

// new device (B) — importToDevice
const { qr: requestQr } = await client.pairing.importToDevice.begin();
const { sas } = await client.pairing.importToDevice.receiveAck(ackCode);
// user compares `sas`, then:
const account = await client.pairing.importToDevice.complete({ qr: grantCode, sasConfirmed: true });
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
   NAME, paymaster/relayer URLs, subname ENS/SNS registrar + parent) for your deployment. Chain
   details and fee tokens come from the registry, not env.
3. **Reskin** — swap the brand values in `src/theme/tokens.css` (the `--*` custom properties)
   and `src/ui/ui.css`, then **delete `src/features.ts`** — it's the parity-harness manifest
   used only by this monorepo's `@avok-demo/coverage` package and has no runtime purpose.
4. **Install** — `pnpm install` in your app; it pulls the published `@avokjs/core` and
   `@avokjs/contracts` packages (plus `viem`, `@solana/kit`, `@solana-program/system`) —
   not `workspace:*` links.
