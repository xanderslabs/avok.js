import type { Hex } from "viem";
import type { Call } from "./registrar.js";
import type { Voucher } from "./voucher.js";

/** Chain-polymorphic mint output: EVM Call[] (ENS) or Solana instructions (SNS). */
export type NameMint =
  | { chain: "evm"; calls: Call[] }
  | { chain: "solana"; instructions: unknown[] };

/**
 * Union of everything any adapter's buildMint needs. Each adapter reads only its fields:
 * - ENS uses `voucher` + `signature` (+ optional `solanaAddress` for coinType-501 enrichment).
 * - SNS uses `label` + `owner` (the user's Solana pubkey, base58).
 */
export interface NameMintInput {
  label: string;
  owner: string;
  solanaAddress?: string;
  voucher?: Voucher;
  signature?: Hex;
}
