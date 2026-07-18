import { createAvokClient as coreCreateAvokClient } from "@avokjs/core";
import type { ClientConfig, Connection, AvokClientFor } from "@avokjs/core";
import {
  createEip1193Provider,
  announceEip6963,
  registerAvokSolanaWallet,
  type Eip1193Provider,
} from "@avokjs/core/provider";

// EIP-6963 identity for the announced Avok provider. A minimal inline icon keeps the bundle self-contained.
const AVOK_ICON = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
const AVOK_RDNS = "com.avokwallet";

export type WiredAvokClient<C extends Connection> = AvokClientFor<C> & {
  /** The EIP-1193 provider this client announced (EIP-6963), for direct (non-wagmi) use. */
  getEip1193Provider(): Eip1193Provider;
};

/**
 * `createAvokClient` + the standard dapp surfaces (VISION §6 "Surface 1"). On construction it builds an
 * EIP-1193 provider over the config, announces it via EIP-6963, and registers the Solana Wallet Standard
 * wallet — in-page, once, and only in a browser (SSR / non-DOM hosts no-op). Returns the client with a
 * `getEip1193Provider()` handle for direct (non-wagmi) use.
 */
export function createAvokClient<C extends Connection>(config: ClientConfig<C>): WiredAvokClient<C> {
  const client = coreCreateAvokClient(config);
  const provider = createEip1193Provider(config, { subscribe: client.subscribe });
  if (typeof window !== "undefined") {
    announceEip6963(provider, { uuid: crypto.randomUUID(), name: "Avok", icon: AVOK_ICON, rdns: AVOK_RDNS });
    registerAvokSolanaWallet(config, { subscribe: client.subscribe });
  }
  return Object.assign(client, { getEip1193Provider: () => provider });
}
