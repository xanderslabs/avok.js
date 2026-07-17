# Send-path redesign — direction & brief

**Status: DRAFT DIRECTION — the seed for a dedicated design pass, not a finalized spec.**
Written 2026-07-17. Companion to [[VISION-AND-STRUCTURE.md]]; that doc is still the yardstick.

## Goal

Thin the transaction path. Avok should provide the **wallet** (7702 + 4337-compatible), the
**passkey / access-key core**, viem-compatible **adapters**, and the **provider** (Surface 1) — and
let developers drive the actual `simulate / send / track` with **stock viem / wagmi / ethers /
permissionless.js**, on both rails. Today `@avokjs/txengine` and `@avokjs/solana-txengine` carry a
full bespoke engine; much of it can be replaced by standard tooling. This matches the original
reference, permissionless.js, and the vision's "plug into wagmi" model.

## Confirmed facts (verified against the code, 2026-07-17)

- **The wallet already batches.** `AvokWalletImplementation.execute(bytes32 mode, bytes data)` with
  `MODE_BATCH` is an ERC-7821 batch. The self-pay branch is gated to a **plain self-call**
  (`msg.sender == address(this)`). Under EIP-7702 `address(this)` *is* the user's EOA, so a self-pay
  batch is just **the EOA sending a normal type-2 (or type-4, carrying the delegation authorization)
  tx to itself** with calldata `execute(MODE_BATCH, calls)`. No new contract function is needed.
- **The sponsored path already sits on viem's standard AA.** `txengine/userop.ts` uses viem's
  `toSmartAccount`, `entryPoint08Address`, `entryPoint08Abi` (EntryPoint v0.8) — the same primitives
  permissionless.js uses. So the Avok wallet can be exposed as a viem-compatible smart account and
  driven by standard AA tooling with a bring-your-own bundler + ERC-7677 paymaster.

## Proposed thin model

- **Self-pay:** ship a small **batch-calldata builder** (`encode calls -> execute(MODE_BATCH,...)`)
  plus a **7702 authorization helper**. The dev sends it as an ordinary tx via viem/wagmi; viem does
  gas estimation, sending, and receipt tracking. No custom `simulate/send/track`.
- **Sponsored:** expose the wallet as a **viem-compatible smart account** (`toAvokSmartAccount`,
  already present). The dev uses **viem AA / permissionless.js** with their own bundler + paymaster.
  Avok provides the adapter, not the orchestration.
- **Provider (Surface 1)** internally uses these minimal builders; the dev-facing story stays "plug
  the EIP-1193 / Wallet-Standard provider into wagmi/viem."

## Locked decisions (fold into this work)

- Rename **`@avokjs/txengine` -> `@avokjs/evm-txengine`** (symmetry with `solana-txengine`; private
  package, low-risk).
- Rail terminology **`fronted` -> `sponsored`**: `Rail = "self-pay" | "sponsored"`. Touches
  `txengine` types + the disclosure/rail logic + a terminology-guard test.

## Open questions to resolve in the design pass

1. **Oracle fate.** The oracle's only remaining job is the gasless **pre-authorization fee bound**
   (convert the signed gas ceiling -> fee-token amount so the user's signature caps the charge;
   `sdk-core/client/fronted-userop.ts`). If the standard ERC-7677 paymaster quote (which viem /
   permissionless already speak) is trusted as the authorization, `@avokjs/oracle` likely **merges
   away**. Decide: keep the independent bound as a safety property, or drop it. *Investigate the full
   quote-vs-bound flow before deciding.*
2. **Reduced `evm-txengine` surface.** What stays (batch-calldata builder, `toAvokSmartAccount`
   adapter, delegation/authorization helpers) vs goes (`simulate.ts`, `track.ts`, `bundler.ts`,
   `paymaster-7677.ts` wrappers — replaceable by viem/permissionless?).
3. **Solana parity.** Can `solana-txengine` lean on `@solana/kit` + a standard relay the same way, or
   is the Kora fee-payer path irreducibly custom?
4. **`sdk-core` / `provider` send path.** How the provider's send handler changes; lifecycle (Surface
   2) is unaffected — only the transacting path moves to standard tooling.
5. **Tracking.** Self-pay -> viem `waitForTransactionReceipt`; sponsored -> bundler receipt. Confirm
   nothing Avok-specific is lost.

## Reference

permissionless.js — smart-account adapters + viem AA, rather than a bespoke engine.
