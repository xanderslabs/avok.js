# Send-path redesign — finalized design

**Status: FINALIZED design. Ready for a plan.** Companion to [[VISION-AND-STRUCTURE.md]] (still the
yardstick). Written 2026-07-17; all open questions from the earlier brief are resolved below.

## Goal

Thin the transaction path. Avok provides the **wallet** (7702 + 4337-compatible), the **passkey /
access-key core**, **viem/kit adapters**, the **consent ceremony**, and the **provider** (Surface 1).
Developers drive `simulate / send / track` with **stock viem / wagmi / ethers / permissionless.js**
(EVM) and **`@solana/kit`** (Solana). Bespoke engine code that standard tooling already does is
retired. This matches permissionless.js (the reference) and the vision's "plug into wagmi" model.

## Principles

1. **Standard tooling does simulate/send/track.** Avok does only what is Avok-specific: batch
   calldata, the 7702 delegation authorization, passkey signing, the consent ceremony, and the
   Solana Kora relay orchestration.
2. **No new contract work.** The wallet already batches (ERC-7821 `execute(MODE_BATCH)`) and is
   4337-compatible (`validateUserOp`, EntryPoint v0.8). See *Confirmed facts*.
3. **Surface 2 (lifecycle facades) is unchanged.** Only the transacting path changes. `create` /
   `login` / `logout` / account state / access-key enrollment / export stay exactly as they are.

## Confirmed facts (verified against the code)

- **The wallet already batches.** `AvokWalletImplementation.execute(bytes32 mode, bytes data)` with
  `MODE_BATCH` is an ERC-7821 batch, self-pay gated to a **plain self-call** (`msg.sender ==
  address(this)`). Under EIP-7702 `address(this)` *is* the EOA, so a self-pay batch is just the EOA
  sending a normal type-2/type-4 tx to itself with `execute(MODE_BATCH, calls)` calldata.
  `buildSelfPayCalldata` is already only `encodeExecuteBatch([...feeCalls, ...userCalls])`.
- **The sponsored path already sits on viem's standard AA.** `txengine/userop.ts` uses viem's
  `toSmartAccount`, `entryPoint08Address`, `entryPoint08Abi`. `prepareFrontedUserOp` is a textbook
  ERC-7677 handshake (`getPaymasterStubData` → `estimateUserOperationGas` → `getPaymasterData`).
- **The oracle is display-only and incomplete.** Its sole use, `computeBoundedUserOpFee`, feeds the
  **consent screen** (`sdk-core/client/evm.ts:348`), not any send gate, and by its own comment
  excludes the paymaster premium. The signed `paymasterData` is the real authorization.
- **Solana already uses standard tooling.** `solana-txengine` is built on `@solana/kit` (8×),
  `@solana/kora` (the relay client), and `@solana-program/token`.

## The design

### EVM

- **Self-pay:** build `execute(MODE_BATCH)` calldata (`encodeExecuteBatch`) and send it as a normal
  **type-4** tx (type-2 once already delegated) via **viem/wagmi**. viem does gas estimation,
  sending, and receipt tracking.
- **Sponsored:** expose the wallet as a **viem-compatible smart account** (`toAvokSmartAccount`,
  already present) and let the dev drive it with **viem AA / permissionless.js** plus a bring-your-own
  bundler + ERC-7677 paymaster. Avok provides the adapter, not the orchestration.
- **Fee display:** the ERC-7677 **paymaster quote** (sponsored) or **viem's gas estimate** (self-pay).

### Solana

- **Self-pay:** build the message (`buildSolanaMessage` / `buildSplTransfer`), sign with the
  passkey-derived key (`toKitSigner`), send/simulate/track via **`@solana/kit`**.
- **Sponsored (Kora):** **retained as Avok orchestration** — Solana has no standard that orchestrates
  a relay fee-payer, so Avok still gets the **Kora fee quote**, builds the fee-payment instruction
  (`buildKoraFeePayment`), combines it with the user's instructions, and has Kora co-sign as
  fee-payer, using the `@solana/kora` client.
- **Fee display:** the **Kora fee quote** (`KoraFeeQuote`) — the analog of the paymaster quote.

### Oracle

**Retired.** `@avokjs/oracle` is deleted; both chains source the sponsored fee from the
paymaster/Kora quote and the self-pay fee from viem/kit. The `nativeUsdFeed` / `usdFeed` entries in
the chain registry (`contracts/src-ts/registry.ts`) that only fed the oracle are trimmed.

## Per-package: before → after

| Package | Before | After |
|---|---|---|
| `oracle` | Chainlink/Pyth USD feeds for the consent fee | **Deleted** — quote-sourced fee display |
| `txengine` → **`evm-txengine`** | Full engine: prepare/simulate/send/track + bundler + paymaster wrappers + fee bound | **Renamed; the oracle fee bound is gone.** Keeps the calldata builder, `toAvokSmartAccount`, delegation/authorization helpers, ABI/mode consts, self-pay estimate/track — **and the bundler/paymaster clients, which a prior cleanup had already reduced to thin viem `createBundlerClient`/`createPaymasterClient` wrappers, kept here as the viem adapters Avok provides** (Option A; not inlined into `sdk-core` — moving already-viem code would only churn the 7702 single-gesture test seam, the one this doc's Risks flag as most fragile). `sdk-core` drives them; the manual single-gesture orchestration is unchanged. |
| `solana-txengine` | Full engine incl. self-pay send/track | **Self-pay thinned to `@solana/kit`;** message/SPL builders, signer adapter, consent decode, and the **Kora sponsored orchestration** kept |
| `sdk-core` | send handlers call the bespoke engines + oracle | Rewired to the minimal builders + viem/kit; `computeBoundedUserOpFee` / oracle wiring removed; **consent decode kept** (fee input changes only) |
| `provider` | EIP-1193/Wallet-Standard over the bespoke send | Same surface, over the thinned send path |

## Locked decisions

- Retire `@avokjs/oracle`.
- Rename `@avokjs/txengine` → `@avokjs/evm-txengine`.
- Rail terminology `fronted` → `sponsored`: `Rail = "self-pay" | "sponsored"` (types + disclosure/rail
  logic + the terminology-guard test).
- Self-pay (both chains) leans on viem/kit; EVM sponsored leans on viem AA / permissionless; Solana
  sponsored keeps the Kora orchestration.

## Implementation sequence (staged — verify green after each)

1. **Retire the oracle.** Delete `@avokjs/oracle`; remove `computeBoundedUserOpFee` and its wiring;
   rewire the consent fee to the paymaster/Kora quote (EVM + Solana); trim the registry `*UsdFeed`
   entries; drop oracle from every package's deps + tsup graphs.
2. **`evm-txengine`.** Rename the package; reduce to the keepers; replace `prepareFrontedUserOp` /
   `bundler.ts` / `paymaster-7677.ts` / `simulate.ts` / `track.ts` with viem AA / permissionless in
   `sdk-core`; keep `encodeExecuteBatch`, `toAvokSmartAccount`, delegation helpers.
3. **`solana-txengine`.** Reduce self-pay to `@solana/kit`; keep the Kora sponsored path; drop the
   oracle-fed pricing in favour of the Kora quote.
4. **Terminology.** `fronted` → `sponsored` across the engines, `sdk-core`, and the guard test.
5. **Rewire `provider` / `sdk-core` send handlers** to the minimal builders. Verify end-to-end: an
   own-origin self-pay send, a sponsored send, a shared-origin popup send, and a provider send driven
   by wagmi/viem.

## Unchanged (do not touch)

Surface 2 lifecycle facades; the wallet contract; `wallet-core` (passkey / access-key / PRF /
signing); the shared-origin popup ceremony and its **consent decode** (only the fee input changes);
the two-surface model of the vision doc.

## Risks / verify during implementation

- **Sign-what-you-saw** must hold: the consent fee (now from the paymaster/Kora quote) must be
  available *before* the single signing gesture, and the send must sign the exact quoted op.
- **Key isolation:** the 7702-authorization / UserOp signing gesture stays after all IO (no live key
  across a network round-trip) even when leaning on viem/permissionless.
- **Compatibility:** confirm viem AA / permissionless drive the Avok EntryPoint-v0.8 `validateUserOp`
  account correctly (the `toAvokSmartAccount` adapter is the seam). **STILL AN OPEN LIVE GATE, not
  closed by this redesign.** `validateUserOp` has never run against a real EntryPoint — only against
  tests (see `contracts/AUDIT-validateUserOp.md`), and the acceptance harness that would close it
  (`examples/scripts/acceptance-evm-*`, referenced from `sdk-core/src/internal/index.ts`) **does not
  exist in the repo.** The redesign left the sponsored UserOp assembly + gesture byte-for-byte, so it
  neither closed nor widened this gate — but "verified" for the sponsored rail means *tests with fake
  bundler/paymaster/RPC*, never a real testnet send. Closing it needs the harness written + Arc
  operator infra (paymaster + bundler URLs + a funded wallet on the one chain the contract is deployed).
- **No self-pay regression:** the type-4 authorization + `execute(MODE_BATCH)` path must produce the
  same on-chain effect the bespoke path did.
