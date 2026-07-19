/**
 * WHAT TO BID AS A SOLANA PRIORITY FEE.
 *
 * `getRecentPrioritizationFees` returns the prioritization fee observed in each of ~150 recent slots.
 * That is RAW DATA, not an answer: picking a number out of it is a policy, and the policy is paid for
 * by the user on every send.
 *
 * The shipped policy was the **MAX of the whole window**. That is an upper bound, not a typical value:
 * ONE congested slot in the last ~150 sets the bid for everyone who sends afterwards, and the user pays
 * it. It is the Solana-shaped cousin of the EVM bug this rail's twin just had — bidding an aggressive
 * number nobody asked for, and passing the cost on.
 *
 * The default here is the **75th percentile**: bid above three quarters of recent slots, which lands
 * promptly without paying for the worst slot in the window. `floorMicroLamports` exists for the case
 * the percentile cannot see — a congestion spike that has not yet appeared in the recent window — and
 * defaults to **0**, because on an uncongested network the correct priority fee genuinely is zero and a
 * non-zero default would charge every user for a spike that is not happening.
 *
 * Solana does NOT publish a recommended tip the way `eth_maxPriorityFeePerGas` does, so unlike the EVM
 * rail there is no authoritative number being ignored here. There is only a choice, and this is it —
 * stated, defaulted, and configurable, rather than implied by a `reduce` that happened to take a max.
 */
export interface PriorityFeePolicy {
  /** 0–100. Default 75. */
  percentile?: number;
  /** Never bid below this, in micro-lamports per compute unit. Default 0. */
  floorMicroLamports?: bigint;
}

export const DEFAULT_PRIORITY_FEE_PERCENTILE = 75;

/**
 * Select the priority fee to bid from a window of recent observations.
 *
 * Exported and pure precisely so the POLICY is testable. It used to live inline in the RPC adapter as a
 * `reduce` taking the maximum, where nothing could reach it — a fee policy nobody can write a test
 * against is a fee policy nobody is checking.
 */
export function selectPriorityFee(recentFees: readonly bigint[], policy: PriorityFeePolicy = {}): bigint {
  const floor = policy.floorMicroLamports ?? 0n;
  if (recentFees.length === 0) return floor; // no data is not evidence of congestion

  const p = policy.percentile ?? DEFAULT_PRIORITY_FEE_PERCENTILE;
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw new Error(`Priority-fee percentile must be between 0 and 100, got ${p}`);
  }

  const sorted = [...recentFees].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // Nearest-rank: the smallest observation at or above the p-th percentile. Index is clamped, so
  // p=100 selects the max (the old behaviour, still reachable — deliberately, and only on request).
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  const chosen = sorted[index]!;

  return chosen > floor ? chosen : floor;
}
