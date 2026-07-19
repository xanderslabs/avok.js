import { createAvokClient as coreCreateAvokClient } from "../engine.js";
import type { ClientConfig, Connection, AvokClientFor } from "../engine.js";
import {
  createEip1193Provider,
  announceEip6963,
  registerAvokSolanaWallet,
  type Eip1193Provider,
} from "../provider/index.js";

/**
 * The OPERATOR's wallet identity, shown in dapp wallet pickers. This is the operator's brand, NOT an
 * Avok one — Avok is a white-label SDK (VISION §1), so the wallet a dapp discovers via EIP-6963 and the
 * Solana Wallet Standard is named and iconed by whoever ships the wallet, never hardcoded here.
 */
export interface WalletInfo {
  /** Display name in the wallet picker (EIP-6963 + Solana Wallet Standard). */
  name: string;
  /** Reverse-DNS wallet id for EIP-6963, e.g. "com.example". */
  rdns: string;
  /** Data-URI icon (EIP-6963 forbids remote URLs). Optional — a blank placeholder is used if omitted. */
  icon?: string;
}

// A neutral, un-branded placeholder used ONLY when the operator supplies no icon — an empty SVG, not an
// Avok mark. EIP-6963 requires a data-URI icon, so the announce must carry something.
const BLANK_ICON = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";

export type WiredAvokClient<C extends Connection> = AvokClientFor<C> & {
  /** The EIP-1193 provider this client announced (EIP-6963), for direct (non-wagmi) use. */
  getEip1193Provider(): Eip1193Provider;
};

/**
 * `createAvokClient` + the standard dapp surfaces (VISION §6 "Surface 1"). On construction it builds an
 * EIP-1193 provider over the config, announces it via EIP-6963, and registers the Solana Wallet Standard
 * wallet — in-page, once, and only in a browser (SSR / non-DOM hosts no-op). Returns the client with a
 * `getEip1193Provider()` handle for direct (non-wagmi) use.
 *
 * `wallet` is the OPERATOR's identity (name/icon/rdns) — required, because a wallet cannot honestly
 * announce itself anonymously in a user's picker. It is never defaulted to an Avok brand.
 */
export function createAvokClient<C extends Connection>(
  config: ClientConfig<C>,
  wallet: WalletInfo,
): WiredAvokClient<C> {
  const client = coreCreateAvokClient(config);
  const provider = createEip1193Provider(config, { subscribe: client.subscribe });
  if (typeof window !== "undefined") {
    const icon = wallet.icon ?? BLANK_ICON; // resolve the fallback ONCE, hand the same icon to both surfaces
    announceEip6963(provider, { uuid: crypto.randomUUID(), name: wallet.name, icon, rdns: wallet.rdns });
    registerAvokSolanaWallet(config, { name: wallet.name, icon, subscribe: client.subscribe });
  }
  return Object.assign(client, { getEip1193Provider: () => provider });
}
