/**
 * createAvokClient (React Native) — the SAME provider wiring as @avokjs/react's, so the two facades are
 * symmetric: build the client, build an EIP-1193 provider over the config, and return the client with a
 * `getEip1193Provider()` handle (feed wagmi/viem or an in-app dapp browser). The EIP-1193 provider is
 * DOM-free, so it works on native unchanged.
 *
 * The ONE piece that is genuinely browser-specific is the ANNOUNCE — EIP-6963 (`window.dispatchEvent`)
 * and the Solana Wallet Standard registry. It is `window`-gated exactly as the browser wiring is: on
 * RN-web (`Platform.OS === "web"`) it fires and consumes `wallet`; on pure native there is no in-page
 * discovery bus, so it no-ops and the native discovery path is a follow-on (VISION §8).
 *
 * (Re-implemented here rather than imported from @avokjs/core's web wiring, which is filed under web/ and
 * whose graph is browser-oriented — the same DOM-free DRY tradeoff AvokProvider/hooks/pairing already make.)
 */
import {
  createAvokClient as coreCreateAvokClient,
  createEip1193Provider,
  announceEip6963,
  registerAvokSolanaWallet,
  resolveAnnouncedIdentity,
} from "@avokjs/core/engine";
import type { ClientConfig, Connection, AvokClientFor, Eip1193Provider, WalletInfo } from "@avokjs/core/engine";

// Neutral, un-branded placeholder used ONLY when the operator supplies no icon (EIP-6963 requires a
// data-URI icon) — an empty SVG, never an Avok mark.
const BLANK_ICON = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";

export type WiredAvokClient<C extends Connection> = AvokClientFor<C> & {
  /** The EIP-1193 provider this client built — for direct (non-wagmi) use, or an in-app dapp browser. */
  getEip1193Provider(): Eip1193Provider;
};

/**
 * `createAvokClient` + the standard dapp surfaces (VISION §6 "Surface 1"), for React Native. Mirrors the
 * browser facade: builds an EIP-1193 provider over the config and, in a browser (RN-web), announces it via
 * EIP-6963 + registers the Solana Wallet Standard wallet. On pure native the announce no-ops.
 *
 * `wallet` is the OPERATOR's identity (name/icon/rdns), symmetric with the browser facade. Every field
 * is optional: an omitted `name` or `rdns` is derived from the page's own origin
 * (`resolveAnnouncedIdentity`), so the announce stays honest — named after the real origin, never
 * anonymous and never an Avok brand. On pure native this branch never runs.
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
