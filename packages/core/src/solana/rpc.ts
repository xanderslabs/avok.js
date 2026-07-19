import {
  createSolanaRpc,
  type Address,
  type Blockhash,
  type Signature,
  type Base64EncodedWireTransaction,
} from "@solana/kit";
import { selectPriorityFee, type PriorityFeePolicy } from "./priority-fee.js";

// blockhash is the kit-branded Blockhash (not a bare string) so buildSolanaMessage can feed the
// tx-lifetime helper without a cast — the brand is what the message builder requires.
export interface LatestBlockhash {
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
}
export interface SimResult {
  err: unknown;
  unitsConsumed?: bigint;
  logs: string[] | null;
}

export interface SolanaRpcClient {
  getLatestBlockhash(): Promise<LatestBlockhash>;
  simulateTransaction(base64Tx: string): Promise<SimResult>;
  sendTransaction(base64Tx: string): Promise<string>; // returns signature
  getSignatureStatus(signature: string): Promise<{ confirmationStatus: string | null; err: unknown } | null>;
  getAccountInfo(address: string): Promise<{ exists: boolean }>;
  getRecentPrioritizationFee(): Promise<bigint>; // micro-lamports/CU
  /** Lamports needed to make an account of `space` bytes rent-exempt. Needed to price a create-ATA:
   *  on the self-pay rail the USER funds that rent, and at ~2,039,280 lamports it dwarfs the ~5,000
   *  base fee. An estimate that omitted it would understate the cost of the send by ~400x. */
  getMinimumBalanceForRentExemption(space: number): Promise<bigint>;
  getBlockHeight(): Promise<bigint>;
}

/** @param policy priority-fee selection. Defaults to p75 with no floor — see priority-fee.ts. */
export function createSolanaRpcClient(url: string, policy: PriorityFeePolicy = {}): SolanaRpcClient {
  const rpc = createSolanaRpc(url);
  return {
    async getLatestBlockhash() {
      const { value } = await rpc.getLatestBlockhash().send();
      return { blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight };
    },
    async simulateTransaction(base64Tx) {
      const { value } = await rpc
        .simulateTransaction(base64Tx as Base64EncodedWireTransaction, { encoding: "base64" })
        .send();
      return { err: value.err, unitsConsumed: value.unitsConsumed ?? undefined, logs: value.logs ?? null };
    },
    async sendTransaction(base64Tx) {
      return (await rpc
        .sendTransaction(base64Tx as Base64EncodedWireTransaction, { encoding: "base64" })
        .send()) as string;
    },
    async getSignatureStatus(signature) {
      const { value } = await rpc.getSignatureStatuses([signature as Signature]).send();
      const s = value[0];
      return s ? { confirmationStatus: s.confirmationStatus ?? null, err: s.err } : null;
    },
    async getAccountInfo(addr) {
      const { value } = await rpc.getAccountInfo(addr as Address, { encoding: "base64" }).send();
      return { exists: value != null };
    },
    async getMinimumBalanceForRentExemption(space) {
      return await rpc.getMinimumBalanceForRentExemption(BigInt(space) as never).send();
    },
    async getRecentPrioritizationFee() {
      const fees = await rpc.getRecentPrioritizationFees().send();
      // p75, not the MAX of the window. Taking the max let ONE congested slot out of ~150 set the bid
      // for everyone who sent afterwards — an upper bound charged to the user as if it were the price.
      // See priority-fee.ts; the policy is a pure function so it can actually be tested.
      return selectPriorityFee(
        fees.map((f: { prioritizationFee: bigint }) => f.prioritizationFee),
        policy,
      );
    },
    async getBlockHeight() {
      return await rpc.getBlockHeight().send();
    },
  };
}
