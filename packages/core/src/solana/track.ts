import type { SolanaRpcClient } from "./rpc.js";
import type { Receipt, ReceiptStatus } from "./types.js";

export async function getReceiptStatus(args: { rpc: SolanaRpcClient; receipt: Receipt }): Promise<ReceiptStatus> {
  const sig = args.receipt.signature;
  if (!sig) return args.receipt.status;
  const s = await args.rpc.getSignatureStatus(sig);
  if (s) {
    if (s.err != null) return "failed";
    if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") return "confirmed";
  }
  // unconfirmed: expired if the chain has advanced past the blockhash validity window. Distinct from
  // "failed" — the tx never landed, so the caller may safely rebuild on a fresh blockhash and resend.
  if (args.receipt.lastValidBlockHeight != null) {
    const height = await args.rpc.getBlockHeight();
    if (height > args.receipt.lastValidBlockHeight) return "expired";
  }
  return "pending";
}
