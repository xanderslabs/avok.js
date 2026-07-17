# @avok-demo/react-own-origin

The canonical **Own-origin** (self-custody) reference app for `@avokjs/react` — WebAuthn
passkeys held in-browser, no custodian, no server-side account. It's also the **clone base**
for building a real product on Avok (e.g. Qudi's beta): copy the directory, swap the brand
tokens, edit config, and go.

Screens: Onboard (create / continue / set up this device) → Home → Send (EVM + Solana, self-pay or
fronted) → Account (sign, export) → Subname (register / resolve) → Device
(add a passkey, SAS pairing).

## Quickstart

```bash
pnpm install
cp examples/react-own-origin/.env.example examples/react-own-origin/.env
pnpm --filter @avok-demo/react-own-origin dev
```

`.env.example` ships with sane testnet defaults — nothing is required to run the app:

- **EVM**: Arc testnet, chain id `5042002` (Circle's stablechain; native gas is USDC).
- **Solana**: `devnet` cluster.
- Fronted sends ("fronted"), Subname (ENS registrar/parent) are opt-in — set the
  relevant `VITE_*` vars in `.env` to enable them.

## Per-feature snippets

These are trimmed excerpts of the real screens (`src/screens/*.tsx`) — see those files for
the full component.

### Create / continue — `src/screens/Onboard.tsx`

```tsx
import { useCreate, useContinue } from "@avokjs/react";

const { create, pending: creating, error: createError } = useCreate();
const { continue: continueAccount, pending: continuing, error: continueError } = useContinue();

await create();          // new passkey + account
await continueAccount(); // existing passkey on this device
```

There is no import: the wallet key is derived from a WebAuthn PRF evaluation, not a seed you can
type in, so there's nothing to import from.

### EVM send — self-pay + fronted — `src/screens/Send.tsx`

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
const selectedFeeToken = effectiveFeeMode === "fronted" ? (feeTokens(chain.id)[feeTokenIdx]?.address ?? null) : null;
const sim = await evmSimulate([call], { chainId: chain.id, feeToken: selectedFeeToken }); // null = self-pay
const receipt = await evmSend(sim, { chainId: chain.id, feeToken: selectedFeeToken });
```

`feeToken: null` pays gas from the account's own balance (self-pay); passing a fee-token **address
supported on that chain** (with `VITE_PAYMASTER_URL` set) fronts the send (fronted). The address is
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
const selectedFeeMint = effectiveFeeMode === "fronted" ? (solanaFeeTokens(config.solanaCluster)[feeTokenIdx]?.mint ?? null) : null;
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

### Subname — an OPTIONAL add-on — `src/screens/Subname.tsx`

Subnames are not part of the wallet. The core client has **no subname verbs**: registration lives
in `@avokjs/subnames`, which the core never depends on. It is **build-only** — it returns
calls and never sends them, so it needs no send seam from the wallet:

```tsx
import { buildSubnameMintCalls, createEnsRegistrar, readMintFee } from "@avokjs/subnames";

// Availability + mint fee are registration-support reads — from the add-on, not the client.
const ens = createEnsRegistrar({ chainId: 1, parent, client: publicClient });
const available = await ens.isAvailable(fullName(label, parent));
const fee = available ? await readMintFee({ client: publicClient, registrar }) : undefined;

// BUILD (add-on) → SEND (wallet). Returns [approve?, mint, setPrimary]; the order is
// load-bearing — the registrar PULLS the fee during mint.
const { name, calls } = await buildSubnameMintCalls({
  label, owner: account.evm.address, parent, registrar, client: publicClient,
  solanaAddress: account.solana.address,
});
const receipt = await client.evm.send(await client.evm.simulate(calls, opts), opts);
```

This app sends via the SDK because **own-origin IS the wallet** and renders its own fee-bearing
consent. A dapp would send the very same calls through the provider's `wallet_sendCalls` — the
add-on neither knows nor cares. It only builds.

The screen has an **ENS / SNS** toggle (`buildSubnameMintCalls` / `buildSnsMintIx`), each gated on
its own config (`VITE_SUBNAME_*` / `VITE_SNS_*`) with its own "not configured" copy.

Forward resolution (name → address) is **not** an add-on concern — it is a core-safe helper, so it
keeps working with `@avokjs/subnames` uninstalled and needs no mint config:

```tsx
import { createNameResolver, createEnsResolver, createSnsResolver } from "@avokjs/helpers";

// Built once in src/resolver.ts; dispatches by suffix (.sol → SNS, else → ENS).
const hit = await resolver.resolveForward("alice.eth"); // → { evm?, solana? } | null
```

### Send to a name anywhere — `@avokjs/helpers`

Every address field (Send recipient, subname lookup) accepts a raw address **or** any
ENS/SNS name. The reusable `resolveRecipient(resolver, input, rail)` helper resolves a name
to the address you pass into tx args, with clear wrong-rail / not-found errors:

```tsx
const rr = await resolveRecipient(resolver, input, rail); // resolver.resolveForward under the hood
if ("error" in rr) show(rr.error);
else simulate([transferTo(rr.address)]); // rr.resolvedFrom is the name it came from
```

### Add a passkey + cross-device pairing — `src/screens/Device.tsx`, `src/pairing/controller.ts`

Two distinct operations:

- **`addPasskey`** — enrol a second credential on the SAME device (a different provider, or a
  hardware key). One call, one funded transaction.
- **Cross-device pairing** — provision the wallet onto a DIFFERENT device. It's inherently
  two-part, so the verbs split by side: `pairing.exportToDevice.*` runs on the existing device,
  `pairing.importToDevice.*` on the new one.

```tsx
import { useSelfCustody } from "@avokjs/react";

const client = useSelfCustody();
const { passkeyCount } = await client.addPasskey(); // enroll a new passkey on this device
```

Pairing another device is a SAS-confirmed handshake — `grant()`/`complete()` only fire after
an explicit user confirmation (`confirm()`), never automatically:

```ts
// existing device (A) — exportToDevice
const { qr: ackQr, sas } = await pairing.exportToDevice.authorize({ qr: requestQr });
// user compares `sas` on both devices, then:
const { qr: grantQr } = await pairing.exportToDevice.grant({ sasConfirmed: true });

// new device (B) — importToDevice
const { qr: requestQr } = await pairing.importToDevice.begin();
const { sas } = await pairing.importToDevice.receiveAck(ackQr);
// user compares `sas`, then:
const account = await pairing.importToDevice.complete({ qr: grantQr, sasConfirmed: true });
```

## Clone into your product

> Runs **standalone** — no operator needed (passkey in-browser). For `.test`-domain / HTTPS
> testing, see [`examples/TESTING.md`](../TESTING.md) and `pnpm demos:domain prepare`.

This app depends only on **published** packages — the `@avokjs/react` facade and
`@avokjs/helpers` (balances, chain metadata + names, recipient resolution, explorers) — plus the public third-party libs `viem`,
`@solana/kit`, `@solana-program/system`, and its own local `src/`. No `@avok-demo/*` and no
private/workspace-only packages. To reuse it as the base for a real product:

1. **Copy the directory** — `examples/react-own-origin/` → your app's location (e.g. `apps/app`).
2. **Edit config** — `src/config.ts` reads `VITE_*` env vars; update `.env` (VITE_RP_ID, the anchor chain
   NAME, paymaster/relayer URLs, subname ENS/SNS registrar + parent) for your deployment. Chain
   details and fee tokens come from the registry, not env.
3. **Reskin** — swap the brand values in `src/theme/tokens.ts` (`palette`, `radius`, `space`,
   `font`, `type`), then **delete `src/features.ts`** — it's the parity-harness manifest used
   only by this monorepo's `@avok-demo/coverage` package and has no runtime purpose.
4. **Install** — `pnpm install` in your app; it pulls the published `@avokjs/react` and
   `@avokjs/contracts` packages (plus `viem`, `@solana/kit`, `@solana-program/system` for
   chain interaction) — not `workspace:*` links.
