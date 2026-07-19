/**
 * The OPERATOR's wallet identity, shown in dapp wallet pickers. This is the operator's brand, NOT an
 * Avok one — Avok is a white-label SDK (VISION §1), so the wallet a dapp discovers via EIP-6963 and the
 * Solana Wallet Standard is named and iconed by whoever ships the wallet, never hardcoded.
 *
 * Lives in `provider/` (not `web/`) so BOTH provider wirings share one type: the browser wiring
 * (`@avokjs/core`) and the React-Native wiring (`@avokjs/react-native`, via `@avokjs/core/engine`).
 */
export interface WalletInfo {
  /** Display name in the wallet picker (EIP-6963 + Solana Wallet Standard). */
  name: string;
  /** Reverse-DNS wallet id for EIP-6963, e.g. "com.example". */
  rdns: string;
  /** Data-URI icon (EIP-6963 forbids remote URLs). Optional — a blank placeholder is used if omitted. */
  icon?: string;
}
