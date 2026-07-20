/**
 * The OPERATOR's wallet identity, shown in dapp wallet pickers. This is the operator's brand, NOT an
 * Avok one — Avok is a white-label SDK (VISION §1), so the wallet a dapp discovers via EIP-6963 and the
 * Solana Wallet Standard is named and iconed by whoever ships the wallet, never hardcoded.
 *
 * Every field is OPTIONAL, but the identity is never anonymous and never an Avok brand. An operator
 * that omits `name` or `rdns` gets an HONEST default derived from the origin the wallet runs at (see
 * `resolveAnnouncedIdentity`): `name` falls back to the hostname, `rdns` to its reverse-DNS form. Set
 * them explicitly for a proper display name and a stable id; the defaults exist so a wallet app on its
 * own domain works without ceremony, not so a wallet can hide who it is.
 *
 * Lives in `provider/` (not `web/`) so BOTH provider wirings share one type and one resolver: the
 * browser wiring (`@avokjs/core`) and the React-Native wiring (`@avokjs/react-native`, via
 * `@avokjs/core/engine`).
 */
export interface WalletInfo {
  /** Display name in the wallet picker (EIP-6963 + Solana Wallet Standard). Defaults to the origin's hostname. */
  name?: string;
  /** Reverse-DNS wallet id for EIP-6963, e.g. "com.example.wallet". Defaults to the origin's reverse-DNS form. */
  rdns?: string;
  /** Data-URI icon (EIP-6963 forbids remote URLs). A blank placeholder is used if omitted. */
  icon?: string;
}

/** Extract a hostname from an origin or a bare hostname. Returns the input unchanged if it is not a URL. */
function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

/**
 * Derive an EIP-6963 reverse-DNS wallet id from an origin or hostname, e.g.
 * "https://wallet.example.com" or "wallet.example.com" -> "com.example.wallet".
 *
 * A convenience for the common case. An operator that wants a specific, stable id passes `rdns`
 * explicitly. IP literals and single-label hosts (localhost) have no meaningful reversal and are
 * returned unchanged; those are development-only origins.
 */
export function rdnsFromOrigin(origin: string): string {
  const host = hostnameOf(origin);
  if (/^[0-9.]+$/.test(host)) return host; // IPv4 literal: reversing it means nothing
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return host; // "localhost" or a bare label
  return labels.reverse().join(".");
}

/**
 * Resolve the concrete `{ name, rdns }` a wiring announces. Operator-supplied fields win; anything
 * absent is derived from `origin` (the page the wallet runs at). Shared by both provider wirings so
 * the browser and React-Native copies cannot drift on how a missing identity is filled in.
 */
export function resolveAnnouncedIdentity(
  wallet: WalletInfo | undefined,
  origin: string,
): { name: string; rdns: string } {
  return {
    name: wallet?.name ?? hostnameOf(origin),
    rdns: wallet?.rdns ?? rdnsFromOrigin(origin),
  };
}
