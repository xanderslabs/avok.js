/**
 * Thrown when a send ASKS for sponsorship and the sponsored rail is not reachable on the target chain.
 *
 * Asking is BINARY: a sponsorship request is either served or it throws. There is no degrade to the
 * native-gas rail, and no flag to enable one.
 *
 * WHY THERE IS NO DEGRADE. Both outcomes it produces are wrong, in opposite directions. The users this
 * rail exists for hold the fee TOKEN and no native gas, so degrading does not rescue their send — it
 * dies anyway, on an "insufficient funds" error naming a native balance instead of the missing
 * endpoint that actually caused it. And a user who happens to hold a little native is worse off still:
 * the send succeeds, spending THEIR OWN funds on gas the developer intended to sponsor. Neither is
 * something the app authorized, and both are a config bug wearing a user-balance costume.
 *
 * Thrown during fee resolution, BEFORE anything is signed or broadcast — and so before the passkey
 * ceremony. Nothing has happened yet, so the app can surface a config error rather than reconciling a
 * transaction the user did not expect.
 *
 * It reports WHICH side is missing, because "sponsorship unavailable" without that is a scavenger
 * hunt across deployment config — and a half-configured rail (one URL present, the other absent) is
 * by far the most common way this happens.
 *
 * The companion to this is the READ side: `supportedFeeTokens()` returns an empty list when no rail is
 * configured, so a fee-token picker built on it has nothing to offer and the dead end is visible in
 * the UI before a send is ever attempted. This error is what catches the case where a token was
 * hardcoded past that list.
 */
export class SponsorshipUnavailableError extends Error {
  /** The chain the sponsored send was attempted on, as a namespaced id (`eip155:10`). */
  readonly chain: string;
  /** The config keys that would have to be set for this send to be sponsored. Never empty. */
  readonly missing: readonly string[];
  /** An ERC-7677 paymaster was configured (URL or injected client). */
  readonly hasPaymaster: boolean;
  /** An ERC-4337 bundler was configured (URL or injected client). */
  readonly hasBundler: boolean;

  /** Built through `evm()`, which is the only rail v1 has. Kept as a factory rather than a public
   *  constructor so a second rail can be added back without changing how the first one is built. */
  private constructor(
    chain: string,
    missing: readonly string[],
    needs: string,
    sides: { hasPaymaster: boolean; hasBundler: boolean },
  ) {
    super(
      `Sponsorship was requested but is unavailable on ${chain}: ${missing.join(" and ")} ${
        missing.length > 1 ? "are" : "is"
      } not configured. Sponsored sends need ${needs}. Configure the missing endpoint, or drop the ` +
        `sponsorship request from this send so the user pays native gas.`,
    );
    this.name = "SponsorshipUnavailableError";
    this.chain = chain;
    this.missing = missing;
    this.hasPaymaster = sides.hasPaymaster;
    this.hasBundler = sides.hasBundler;
  }

  /**
   * Takes RESOLVED booleans rather than the URLs: either side may be satisfied by an injected client
   * (`deps.paymaster` / `deps.bundler`) instead of a URL, and reading the URLs alone would tell a
   * developer their bundler is missing while they are looking at the one they injected.
   */
  static evm(chainId: number, configured: { hasPaymaster: boolean; hasBundler: boolean }): SponsorshipUnavailableError {
    const { hasPaymaster, hasBundler } = configured;
    const missing = [!hasPaymaster && "paymasterUrl", !hasBundler && "bundlerUrl"].filter(Boolean) as string[];
    return new SponsorshipUnavailableError(
      `eip155:${chainId}`,
      missing,
      "BOTH an ERC-7677 paymaster and an ERC-4337 bundler",
      { hasPaymaster, hasBundler },
    );
  }
}
