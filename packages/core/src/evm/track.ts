import type { RpcClient } from "./rpc.js";
import type { Receipt } from "./types.js";

export interface TrackDeps {
  rpc: RpcClient;
}

/**
 * Native-gas receipt tracking: poll the chain for the transaction receipt. Sponsored (4337) receipts are
 * tracked through the bundler (`eth_getUserOperationReceipt`) in the SDK's `wait()`, not here — this
 * only ever advances a native-gas receipt from `submitted` to `confirmed`/`failed`.
 */
export async function getReceiptStatus(receipt: Receipt, deps: TrackDeps): Promise<Receipt> {
  if (receipt.rail !== "native-gas") return receipt;
  if (!receipt.txHash) return receipt;
  const r = await deps.rpc.getTransactionReceipt(receipt.txHash);
  if (!r) return receipt; // not mined yet
  return { ...receipt, status: r.status === "success" ? "confirmed" : "failed", txHash: r.transactionHash };
}
