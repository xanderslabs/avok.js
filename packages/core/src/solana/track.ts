import type { SolanaRpcClient } from "./rpc.js";
import type { Receipt } from "./types.js";

export interface TrackDeps {
  rpc: SolanaRpcClient;
}

/** Poll a Solana receipt to its next status. Mirrors the EVM rail's `getReceiptStatus`
 *  (`(receipt, deps) => Receipt`), so both rails advance a receipt the same way. */
export async function getReceiptStatus(receipt: Receipt, deps: TrackDeps): Promise<Receipt> {
  const sig = receipt.signature;
  if (!sig) return receipt;
  const s = await deps.rpc.getSignatureStatus(sig);
  if (s?.err != null) return { ...receipt, status: "failed" };
  if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
    return { ...receipt, status: "confirmed" };
  }
  // unconfirmed: expired if the chain has advanced past the blockhash validity window. Distinct from
  // "failed" — the tx never landed, so the caller may safely rebuild on a fresh blockhash and resend.
  if (receipt.lastValidBlockHeight != null) {
    const height = await deps.rpc.getBlockHeight();
    if (height > receipt.lastValidBlockHeight) return { ...receipt, status: "expired" };
  }
  return { ...receipt, status: "pending" };
}
