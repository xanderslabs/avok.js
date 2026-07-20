/**
 * Thrown when a send asks for sponsorship, the app set `requireSponsorship`, and the sponsored rail
 * is not reachable on the target chain.
 *
 * By default a fee token on a chain with no bundler+paymaster degrades to self-pay (SPEC §1), which
 * is correct for an app that sponsors on some chains and not others. It is wrong for an app whose
 * paymaster URL simply failed to reach production, and the SDK cannot tell those apart — both are an
 * absent string. `requireSponsorship` is the app stating which case it is in, and this is what it
 * gets instead of a silent degrade.
 *
 * Thrown during fee resolution, BEFORE anything is signed or broadcast: nothing has happened yet, so
 * the app can surface a real message rather than reconciling a transaction the user did not expect.
 *
 * It reports WHICH side is missing, because "sponsorship unavailable" without that is a scavenger
 * hunt across deployment config — and a half-configured rail (one URL present, the other absent) is
 * by far the most common way this happens.
 */
export class SponsorshipUnavailableError extends Error {
  /** The chain the sponsored send was attempted on, as a namespaced id (`eip155:<id>`). */
  readonly chain: string;
  /** Whether an ERC-7677 paymaster was configured (URL or injected client). */
  readonly hasPaymaster: boolean;
  /** Whether an ERC-4337 bundler was configured (URL or injected client). */
  readonly hasBundler: boolean;

  /**
   * Takes RESOLVED booleans rather than the URLs: either side may be satisfied by an injected client
   * (`deps.paymaster` / `deps.bundler`) instead of a URL, and reading the URLs alone would tell a
   * developer their bundler is missing while they are looking at the one they injected.
   */
  constructor(chainId: number, configured: { hasPaymaster: boolean; hasBundler: boolean }) {
    const { hasPaymaster, hasBundler } = configured;
    const missing = [!hasPaymaster && "paymasterUrl", !hasBundler && "bundlerUrl"].filter(Boolean).join(" and ");

    super(
      `Sponsorship is required but unavailable on chain ${chainId}: ${missing} ${
        missing.includes("and") ? "are" : "is"
      } not configured. ` +
        `Sponsored sends need BOTH an ERC-7677 paymaster and an ERC-4337 bundler. Configure the ` +
        `missing endpoint, or drop requireSponsorship to let this send self-pay instead.`,
    );
    this.name = "SponsorshipUnavailableError";
    this.chain = `eip155:${chainId}`;
    this.hasPaymaster = hasPaymaster;
    this.hasBundler = hasBundler;
  }
}
