import {
  signTransactionMessageWithSigners,
  partiallySignTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import type { SolanaRpcClient } from "./rpc.js";
import type { KoraClient } from "./kora.js";
import type { Receipt } from "./types.js";

export async function sendSolana(args: {
  rail: "self-pay" | "sponsored";
  message: unknown;
  lastValidBlockHeight: bigint;
  cluster: "mainnet" | "devnet";
  rpc?: SolanaRpcClient; // self-pay
  kora?: KoraClient; // sponsored — Kora is BOTH the fee payer and the submitter
}): Promise<Receipt> {
  if (args.rail === "self-pay") {
    if (!args.rpc) throw new Error("self-pay requires an rpc");
    // ONE gesture: user is both authority + fee-payer signer
    const signed = await signTransactionMessageWithSigners(args.message as never);
    const base64 = getBase64EncodedWireTransaction(signed);
    const signature = await args.rpc.sendTransaction(base64);
    return {
      id: signature,
      rail: "self-pay",
      status: "submitted",
      signature,
      cluster: args.cluster,
      lastValidBlockHeight: args.lastValidBlockHeight,
    };
  }

  // sponsored
  if (!args.kora) throw new Error("sponsored requires a kora client");
  // ONE gesture: user authority slot only; Kora's fee-payer slot is left empty (null) and Kora fills it
  // on the far side. The fee-payment instruction is already inside these bytes (see kora-fee.ts), so
  // what the user consented to is exactly what Kora gets paid.
  const partiallySigned = await partiallySignTransactionMessageWithSigners(args.message as never);
  const base64 = getBase64EncodedWireTransaction(partiallySigned);
  // Kora co-signs as fee payer AND broadcasts, so unlike the bespoke relayer's opaque intent id, this
  // hands back a real signature the caller can track on-chain immediately.
  const { signature } = await args.kora.signAndSendTransaction(base64);
  return {
    id: signature,
    rail: "sponsored",
    status: "pending",
    signature,
    cluster: args.cluster,
    lastValidBlockHeight: args.lastValidBlockHeight,
  };
}
