import { createAvokClient as coreCreateAvokClient } from "../engine.js";
import type { ClientConfig, Connection, AvokClientFor } from "../engine.js";
import {
  createEip1193Provider,
  announceEip6963,
  registerAvokSolanaWallet,
  resolveAnnouncedIdentity,
  type Eip1193Provider,
  type WalletInfo,
} from "../provider/index.js";

// WalletInfo now lives in provider/ (shared with the RN wiring); re-exported so `@avokjs/core`'s
// public surface is unchanged.
export type { WalletInfo };

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
 * `wallet` is the OPERATOR's identity (name/icon/rdns). Every field is optional: an omitted `name` or
 * `rdns` is derived from the page's own origin (`resolveAnnouncedIdentity`), which keeps the announce
 * honest — named after the real origin, never anonymous and never an Avok brand. Pass them explicitly
 * for a proper display name and a stable id.
 */
export function createAvokClient<C extends Connection>(
  config: ClientConfig<C>,
  wallet?: WalletInfo,
): WiredAvokClient<C> {
  const client = coreCreateAvokClient(config);
  const provider = createEip1193Provider(config, { subscribe: client.subscribe });
  if (typeof window !== "undefined") {
    const icon = wallet?.icon ?? BLANK_ICON; // resolve the fallback ONCE, hand the same icon to both surfaces
    const { name, rdns } = resolveAnnouncedIdentity(wallet, window.location.origin);
    announceEip6963(provider, { uuid: crypto.randomUUID(), name, icon, rdns });
    registerAvokSolanaWallet(config, { name, icon, subscribe: client.subscribe });
  }
  return Object.assign(client, { getEip1193Provider: () => provider });
}
