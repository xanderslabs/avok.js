import type { Address, Hex } from "viem";
import type { Call } from "../wallet/index.js";

export type { Call };

export type Rail = "self-pay" | "sponsored";

export interface ExecutionContext {
  chainId: number;
  /** Present (per-call or client default) ⇒ sponsored; absent/null ⇒ self-pay. */
  feeToken?: Address | null;
  /** `false` opts out of gas estimation (fixed-fallback confidence). */
  gas?: boolean;
}

/** The single source of rail selection — the rail is data, not a verb. */
export function railFromContext(ctx: ExecutionContext): Rail {
  return ctx.feeToken ? "sponsored" : "self-pay";
}

export type Disclosure =
  | { kind: "fee"; feeToken: Address; amount: bigint }
  | { kind: "delegation"; implementation: Address };

export interface PendingAuthorization {
  chainId: number;
  /** Delegation target = canonicalImplementation. */
  address: Address;
  /** EOA nonce the 7702 authorization is signed over. */
  nonce: number;
}

export interface ResolvedBatch {
  rail: Rail;
  chainId: number;
  /** The wallet's own address — required for simulation. */
  walletAddress: Address;
  /** Committed "must-land-if-paid" calls (fee/access-slot). */
  feeCalls: Call[];
  /** The app's revert-isolated calls. */
  userCalls: Call[];
  /** SPONSORED (4337) only — the ERC-7677 paymaster `context` fee token this batch is sponsored in
   *  (`null`/absent ⇒ a single-token paymaster implies it, e.g. Circle USDC). Carried so a
   *  `SimulationResult` re-sent verbatim sponsors in the SAME token the user saw. */
  feeToken?: Address | null;
  authorization?: PendingAuthorization;
  /** The self-pay intent nonce. (The 4337 sponsored rail uses the EntryPoint's own 2D nonce instead,
   *  fetched at send time — this field is not the sponsored nonce.) */
  nonce: bigint;
  deadline: bigint;
  disclosures: Disclosure[];
  /**
   * THE FEE THIS BATCH WAS PRICED WITH — the one committed to `feeCalls`, and therefore the one the
   * user SIGNS. It is the only fee that may ever be shown to them.
   *
   * `simulateResolved` used to RE-PRICE the fee for display, from the simulation's own gas number,
   * while `feeCalls` had been priced earlier from `fullGasEstimate` (which also covers the EIP-7702
   * authorization intrinsic and the fee transfer). Two gas numbers, two fees, in one SimulationResult:
   * the app showed one and the user signed the other. On real hardware a send displayed 0.001921 USDC
   * and moved 0.004104. Price ONCE, show what is signed.
   */
  fee?: FeeBreakdown;
  /**
   * SELF-PAY ONLY — what this transaction is expected to cost the wallet in the chain's NATIVE gas
   * asset. Nothing signs it (self-pay commits no fee call; the chain debits the wallet at inclusion),
   * so it is an ESTIMATE, not a promise — see NativeFeeEstimate.
   *
   * It exists because "self-pay" is not an excuse to show the user no number at all.
   */
  nativeFee?: NativeFeeEstimate;
}

export type SimulationConfidence = "exact" | "estimated" | "unsupported";
export type SimMethod = "eth_simulateV1" | "state-override" | "fallback";

export interface DecodedCall {
  to: Address;
  value: bigint;
  selector: Hex;
  /** Best-effort human label, e.g. "transfer(address,uint256)". */
  label?: string;
}

export interface FeeBreakdown {
  feeToken: Address;
  amount: bigint;
  gasUnits: bigint;
  gasPrice: bigint;
}

/**
 * The expected native-gas cost of a SELF-PAY transaction.
 *
 * Deliberately NOT a `FeeBreakdown`. A FeeBreakdown is a fee the user signs for, denominated in an
 * ERC-20 fee token, exact and committed. This is neither: the chain charges baseFee + tip at
 * inclusion, so the real cost is only knowable afterwards. Two different things, two different types
 * — so no UI can accidentally render an estimate as if it were the signed amount.
 */
export interface NativeFeeEstimate {
  /**
   * Expected cost in native WEI — always 18 decimals, on every chain. Note this is NOT the decimals
   * of the same-named ERC-20 elsewhere on the chain: Arc's native gas asset is USDC and its gas
   * accounting is 18-dec wei, while its ERC-20 USDC is 6-dec. Formatting this with 6 would overstate
   * the fee by a factor of a trillion.
   */
  amount: bigint;
  gasUnits: bigint;
  /** The effective price used — baseFee + tip, NOT the maxFeePerGas ceiling. */
  gasPrice: bigint;
}

export interface SimulationResult {
  batch: ResolvedBatch;
  success: boolean;
  gasEstimate: bigint;
  /** Sponsored only — the signed, committed fee. */
  fee?: FeeBreakdown;
  /** Self-pay only — the ESTIMATED native cost. Never signed. */
  nativeFee?: NativeFeeEstimate;
  decodedCalls: DecodedCall[];
  disclosures: Disclosure[];
  confidence: SimulationConfidence;
  method: SimMethod;
  revertReason?: string;
}

export type ReceiptStatus = "pending" | "submitted" | "confirmed" | "failed";

export interface Receipt {
  /** txHash (self-pay) or intent id (sponsored). */
  id: string;
  rail: Rail;
  status: ReceiptStatus;
  txHash?: Hex;
  chainId: number;
  /** Why it failed, when it did. A "failed" receipt with no reason is undiagnosable from the app. */
  error?: string;
}
