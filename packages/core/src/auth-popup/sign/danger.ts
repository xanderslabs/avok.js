/**
 * What Avok considers dangerous, and why.
 *
 * Deliberately a separate file: this is security policy, and it should be reviewable without the
 * rendering around it. Everything here is static and bundled. The Vault has no network, so there is
 * no ABI lookup, no selector registry, and no scam-address feed. A list that needs a live feed to be
 * true would be stale the day it shipped, and claiming a protection Avok does not have is worse than
 * not having it.
 */

export type Severity = "info" | "caution" | "danger";

/**
 * A uint256 approval at or above this is effectively unlimited. 2^255 sits far above any real
 * approval (1e27 is a billion tokens at 18 decimals) and catches both common encodings, 2^256-1 and
 * 2^255.
 *
 * Exported for callers that want to describe the rule. The operative test is the lower uint160
 * threshold below, which subsumes this one; both are kept because they answer different questions
 * ("what counts as unlimited for a uint256 allowance" versus "what does this code actually flag").
 */
export const UNLIMITED_THRESHOLD = 2n ** 255n;

/**
 * Permit2 stores allowances as uint160, so its "unlimited" is 2^160-1. That is far below
 * UNLIMITED_THRESHOLD, so the uint256 rule alone would wave it through as an ordinary number. This
 * threshold sits above any plausible real amount (2^159 is ~7.3e47 base units, which is ~7.3e29
 * tokens at 18 decimals) and below the uint160 max.
 */
const UNLIMITED_UINT160_THRESHOLD = 2n ** 159n;

/**
 * Whether an amount, in base units, is effectively unlimited.
 *
 * Answers false for anything it cannot parse. The input arrives from a decoded payload and is not
 * guaranteed to be a number, and a false "unlimited" warning on every unparseable field would teach
 * people to click past the warning that matters. An amount this cannot read is still rendered
 * verbatim on the screen, so nothing is hidden by staying quiet here.
 */
export function isUnlimitedAmount(baseUnits: string): boolean {
  let n: bigint;
  try {
    n = BigInt(baseUnits);
  } catch {
    return false;
  }
  return n >= UNLIMITED_UINT160_THRESHOLD;
}

/**
 * EIP-712 primary types that grant spending authority by signature alone.
 *
 * These are the modern drain: no transaction, no calldata, no gas, and nothing on chain until the
 * attacker chooses. Matched case-sensitively, because a lookalike differing only in case is not a
 * type we know and must not be presented as one.
 */
const DANGEROUS_PRIMARY_TYPES: Record<string, string> = {
  Permit: "This signature lets someone spend your tokens without a transaction.",
  PermitSingle: "This Permit2 signature lets someone spend your tokens without a transaction.",
  PermitBatch: "This Permit2 signature lets someone spend several of your tokens without a transaction.",
  PermitTransferFrom: "This Permit2 signature lets someone move your tokens without a transaction.",
  PermitBatchTransferFrom: "This Permit2 signature lets someone move several of your tokens without a transaction.",
};

/** The reason a primary type is dangerous, or null. `hasOwnProperty` rather than a bare lookup, so
 *  "constructor" and "toString" answer about the TABLE and not about Object.prototype. */
export function dangerousPrimaryType(primaryType: string): string | null {
  return Object.prototype.hasOwnProperty.call(DANGEROUS_PRIMARY_TYPES, primaryType)
    ? DANGEROUS_PRIMARY_TYPES[primaryType]
    : null;
}
