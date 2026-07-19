# @avok-demo/react-own-origin

The canonical **Own-origin** (self-custody) reference app for `@avokjs/react` — WebAuthn
passkeys held in-browser, no custodian, no server-side account. It's also the **clone base**
for building a real product on Avok (e.g. Qudi's beta): copy the directory, swap the brand
tokens, edit config, and go.

Screens: Onboard (create / log in / set up this device) → Home → Send (EVM + Solana, self-pay or
sponsored; recipient accepts an ENS/SNS name) → Account (sign, export) → Access (the trust surface —
who can reach this wallet) → Device (add an access slot, SAS cross-device pairing).

## Quickstart

```bash
pnpm install
cp examples/react-own-origin/.env.example examples/react-own-origin/.env
pnpm --filter @avok-demo/react-own-origin dev
```

`.env.example` ships with sane testnet defaults — nothing is required to run the app:

- **EVM**: Arc testnet, chain id `5042002` (Circle's stablechain; native gas is USDC).
- **Solana**: `devnet` cluster.
- Sponsored sends (the "sponsored" rail) are opt-in — set the relevant `VITE_*` vars (paymaster /
  bundler / Kora) in `.env` to enable them. (Name **resolution** — sending to `alice.eth` / `alice.sol`
  — is always on and needs no config; Avok does no name registration.)

## Per-feature snippets

These are trimmed excerpts of the real screens (`src/screens/*.tsx`) — see those files for
the full component.

### Create / log in — `src/screens/Onboard.tsx`

```tsx
import { useCreate, useLogin } from "@avokjs/react";

const { create, pending: creating, error: createError } = useCreate();
const { login, pending: loggingIn, error: loginError } = useLogin();

await create(); // new passkey + account
await login();  // existing passkey on this device
```

There is no import: the wallet key is derived from a WebAuthn PRF evaluation, not a seed you can
type in, so there's nothing to import from.

### EVM send — self-pay + sponsored — `src/screens/Send.tsx`

Sending and signing are **not** framework hooks (VISION §6). An own-origin app owns its wallet UX, so
it drives the SDK client's `evm` / `solana` namespaces directly (`useAvok()` returns that client);
sending through the announced EIP-1193 provider + wagmi is the *shared-origin* dapp path instead.

```tsx
import { useAvok } from "@avokjs/react";
import { encodeFunctionData, erc20Abi } from "viem";

const client = useAvok();

const call = {
  to: evmToken.address,
  value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amountBase] }),
};
// Fee tokens are chain-specific — read the supported ones for THIS chain from the client and let the
// user pick.
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

### Sign a message + export the key — `src/screens/Account.tsx`

Own-origin IS the wallet, so it signs in-page via the client's `evm` / `solana` namespaces, and can
export the raw key (needs the self-custody client):

```tsx
import { useAvok, useSelfCustody } from "@avokjs/react";

const client = useAvok();
const evmSig = await client.evm.signMessage({ message });        // hex signature
const { signature: solSig } = await client.solana.signMessage(message);

// Export — exportEvmKey is the ROOT key (alone it restores the whole wallet, both chains, VISION §5);
// exportSolanaKey is the leaf. Only a self-custody connection exposes these.
const custody = useSelfCustody();
const evmKey = await custody.exportEvmKey();
const solanaKey = await custody.exportSolanaKey();
```

### Send to a name anywhere — `@avokjs/core/helpers`

Every address field (Send recipient, subname lookup) accepts a raw address **or** any
ENS/SNS name. The reusable `resolveRecipient(resolver, input, rail)` helper resolves a name
to the address you pass into tx args, with clear wrong-rail / not-found errors:

```tsx
const rr = await resolveRecipient(resolver, input, rail); // resolver.resolveForward under the hood
if ("error" in rr) show(rr.error);
else simulate([transferTo(rr.address)]); // rr.resolvedFrom is the name it came from
```

### Add an access slot + cross-device pairing — `src/screens/Device.tsx`, `src/pairing/controller.ts`

Both operations enrol an **access slot** (a per-origin passkey that can reach the wallet key, §3), via
one verb with two forms:

- **`client.enrollAccessSlot()`** — enrol a second credential on the SAME device (a different provider,
  or a hardware key). One call, one funded transaction.
- **`client.enrollAccessSlot.viaPairing`** — provision the wallet onto a DIFFERENT device. It's
  inherently two-part, so the verbs split by side: `.holder` runs on the existing device (it holds the
  wallet and pays), `.enroller` on the new one. React devs can skip this wiring entirely and use the
  `usePairingCeremony()` hook / `<PairDevice>` from `@avokjs/react`.

```tsx
import { useSelfCustody } from "@avokjs/react";

const client = useSelfCustody();
const { passkeyCount } = await client.enrollAccessSlot(); // new access slot on this device
```

Pairing another device is a SAS-confirmed handshake — the writes that assert `sasConfirmed: true` only
fire after the user compares the code on both devices; the wallet key never travels (an encrypted blob
does), and the holder pays for the on-chain write:

```ts
const pairing = client.enrollAccessSlot.viaPairing;

// new device (B) — enroller: begin → receive ack → (SAS) → enroll
const { qr: requestQr } = await pairing.enroller.begin();
const { sas } = await pairing.enroller.receiveAck(ackQr);
// user compares `sas` on both devices, then:
const { qr: wrapQr } = await pairing.enroller.enroll({ sasConfirmed: true });

// existing device (A) — holder: authorize → (SAS) → complete (writes the access slot, and pays)
const { qr: ackQr, sas } = await pairing.holder.authorize({ qr: requestQr });
// user compares `sas`, then:
await pairing.holder.complete({ qr: wrapQr, sasConfirmed: true });
```

## Clone into your product

> Runs **standalone** — no operator needed (passkey in-browser). For `.test`-domain / HTTPS
> testing, see [`examples/TESTING.md`](../TESTING.md) and `pnpm demos:domain prepare`.

This app depends only on **published** packages — the `@avokjs/react` facade and
`@avokjs/core/helpers` (balances, chain metadata + names, recipient resolution, explorers) — plus the public third-party libs `viem`,
`@solana/kit`, `@solana-program/system`, and its own local `src/`. No `@avok-demo/*` and no
private/workspace-only packages. To reuse it as the base for a real product:

1. **Copy the directory** — `examples/react-own-origin/` → your app's location (e.g. `apps/app`).
2. **Edit config** — `src/config.ts` reads `VITE_*` env vars; update `.env` (VITE_RP_ID, the anchor chain
   NAME, paymaster / bundler / Kora URLs for the sponsored rail) for your deployment. Chain
   details and fee tokens come from the registry, not env.
3. **Reskin** — swap the brand values in `src/theme/tokens.ts` (`palette`, `radius`, `space`,
   `font`, `type`), then **delete `src/features.ts`** — it's the parity-harness manifest used
   only by this monorepo's `@avok-demo/coverage` package and has no runtime purpose.
4. **Install** — `pnpm install` in your app; it pulls the published `@avokjs/react` and
   `@avokjs/contracts` packages (plus `viem`, `@solana/kit`, `@solana-program/system` for
   chain interaction) — not `workspace:*` links.
