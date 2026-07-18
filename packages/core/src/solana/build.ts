import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  address,
  type Instruction,
  type TransactionPartialSigner,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import type { SolanaRpcClient } from "./rpc.js";

export type FeePayer =
  | { kind: "address"; address: string }          // sponsored: the relayer (we don't hold its key)
  | { kind: "signer"; signer: TransactionPartialSigner }; // self-pay: the user

export async function buildSolanaMessage(args: {
  rpc: SolanaRpcClient;
  instructions: Instruction[];   // user (+ sponsored fee/ATA) instructions, already assembled by the caller
  feePayer: FeePayer;
  computeUnitLimit: number;
  computeUnitPrice: bigint;      // micro-lamports per CU
}): Promise<{ message: unknown; lastValidBlockHeight: bigint }> {
  const { blockhash, lastValidBlockHeight } = await args.rpc.getLatestBlockhash();
  const budget: Instruction[] = [
    getSetComputeUnitLimitInstruction({ units: args.computeUnitLimit }),
    getSetComputeUnitPriceInstruction({ microLamports: args.computeUnitPrice }),
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => args.feePayer.kind === "signer"
      ? setTransactionMessageFeePayerSigner(args.feePayer.signer, m)
      : setTransactionMessageFeePayer(address(args.feePayer.address), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions([...budget, ...args.instructions], m),
  );
  return { message, lastValidBlockHeight };
}
