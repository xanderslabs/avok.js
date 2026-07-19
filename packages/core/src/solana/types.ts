export type Rail = "self-pay" | "sponsored";

export interface SolanaExecutionContext {
  cluster: "mainnet" | "devnet";
  /** Present (mint) ⇒ sponsored; absent/null ⇒ self-pay. */
  feeToken?: string | null;
  /** Optional priority-fee override (micro-lamports per CU). */
  computeUnitPrice?: bigint;
}

export function railFromContext(ctx: SolanaExecutionContext): Rail {
  return ctx.feeToken ? "sponsored" : "self-pay";
}

export interface DecodedInstruction {
  programAddress: string;
  accountCount: number;
  label?: string;
}

/**
 * The exact, bounded fee a SPONSORED transaction pays in an SPL token — the number the user consents to
 * and the signed bytes then transfer (sign-what-you-saw).
 *
 * Three fields, because a Kora quote IS three numbers. Kora simulates the transaction it is being asked
 * to pay for and answers with one all-in total, so there is no base/priority/rent split to report and no
 * oracle rate behind it. This deliberately does not carry optional fields for those: a type that
 * advertises a breakdown nothing can populate invites a caller to render `rent: 0` and tell the user
 * rent is free — which is the under-pricing that made every sponsored send opening a token account come
 * back `fee_too_low`. The self-pay estimate is a different animal and says so: `SolanaNativeFeeEstimate`.
 */
export interface FeeBreakdown {
  feeToken: string;
  amount: bigint;
  /** Lamports the fee covers (Kora reports this as `fee_in_lamports`). */
  lamportsTotal: bigint;
}

/**
 * What a SELF-PAY transaction costs the wallet in SOL. Deliberately not a `FeeBreakdown`: that is an
 * exact amount, denominated in an SPL fee token, which the user signs for. This is an estimate the
 * chain charges at inclusion, and nothing signs it.
 *
 * `rent` is broken out because it is not a fee. It funds the RECIPIENT's new token account, it is
 * refundable to them, and at ~2,039,280 lamports it is ~400x the base fee — so it can be neither
 * hidden inside a "network fee" nor left out.
 */
export interface SolanaNativeFeeEstimate {
  baseFee: bigint;
  priorityFee: bigint;
  rent: bigint;
  /** baseFee + priorityFee + rent — the total SOL the wallet is out. */
  lamports: bigint;
}

export type SimulationConfidence = "exact" | "unsupported";
export interface SimulationResult {
  success: boolean;
  computeUnits: bigint;
  /** Sponsored only — the exact fee, signed, paid in an SPL token. */
  fee?: FeeBreakdown;
  /** Self-pay only — the ESTIMATED SOL cost. Never signed. */
  nativeFee?: SolanaNativeFeeEstimate;
  decodedInstructions: DecodedInstruction[];
  confidence: SimulationConfidence;
  error?: string;
}

// "failed" = the tx landed and reverted (do not resend). "expired" = the blockhash lifetime lapsed
// before inclusion, so it can never land — safe (and expected) to rebuild against a fresh blockhash
// and resend. Kept distinct because they drive opposite retry decisions.
export type ReceiptStatus = "pending" | "submitted" | "confirmed" | "failed" | "expired";
export interface Receipt {
  id: string;
  rail: Rail;
  status: ReceiptStatus;
  signature?: string;
  cluster: "mainnet" | "devnet";
  lastValidBlockHeight?: bigint;
  /** Why the relayer could not submit it. A bare "Failed" is undiagnosable from the app. */
  error?: string;
}
