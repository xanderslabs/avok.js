import { createOwnOriginConnection as sdkCreateOwnOrigin, createSharedOriginConnection as sdkSharedOrigin } from "@avokjs/sdk-core";
import type { StorageAdapter, Connection, SelfCustodyConnection } from "@avokjs/sdk-core";
import type { ChainId } from "@avokjs/contracts";
import { buildWebPasskeyAdapter } from "./web-platform.js";
import { webStorage } from "./web-storage.js";

// The client factory, wrapped to announce the EIP-1193 provider + register the Solana Wallet Standard
// wallet on construction (VISION §6 Surface 1). See provider-wiring.ts.
export { createAvokClient } from "./provider-wiring.js";
export type { WiredAvokClient } from "./provider-wiring.js";
export type { StorageAdapter, Connection, SelfCustodyConnection, Account, ClientConfig, FullAvokClient, UseOnlyAvokClient, AvokClientFor, AvokClient, CreateOpts, ContinueOpts, TxOpts, EvmFeeToken } from "@avokjs/sdk-core";
export type {
  SolanaTxOpts,
  SolanaNamespace,
  SolanaResolved,
  SolanaSimulation,
  FeeToken,
} from "@avokjs/sdk-core";

// The named error thrown when a fee token is not supported on the target chain (chain-specific
// fee-token addresses). Exported as a value so apps can `instanceof`-narrow it.
export { UnsupportedFeeTokenError } from "@avokjs/sdk-core";

// Re-export webStorage so callers can supply the same adapter to other seams.
export { webStorage } from "./web-storage.js";

/**
 * Creates an own-origin passkey connection wired with the web platform trio:
 * - WebAuthnPasskeyAdapter (platform credential, PRF — no largeBlob; iCloud Keychain lacks it)
 * - localStorage-backed StorageAdapter (memory fallback for SSR)
 *
 * Device-gated: real WebAuthn create/get require a browser with platform
 * authenticator support. Unit tests assert wiring (Connection verbs) only.
 */
export function createOwnOriginConnection(opts: {
  rpId: string;
  /** Cosmetic friendly operator name: becomes the WebAuthn `rp.name` (the OS "Sign in to …" prompt)
   *  AND the passkey wallet-label prefix ("<operatorName> Wallet · Nickname"). Defaults to the rpId
   *  domain when unset. Display only — it never affects the rpId, the PRF scope, or key material. */
  operatorName?: string;
  storage?: StorageAdapter;
  /** CAIP-2 chain where this wallet anchors its secondary-device access slots (default eip155:10). */
  anchorChainId?: ChainId;
}): SelfCustodyConnection {
  return sdkCreateOwnOrigin({
    rpId: opts.rpId,
    operatorName: opts.operatorName,
    passkey: buildWebPasskeyAdapter(opts.rpId, opts.operatorName),
    storage: opts.storage ?? webStorage(),
    anchorChainId: opts.anchorChainId,
  });
}

/**
 * Lazily creates a shared-origin connection backed by a web popup channel.
 *
 * Bundle-purity: @avokjs/network (createWebChannel) is imported DYNAMICALLY
 * inside this function body. An own-origin-only app that never calls
 * createSharedOriginConnection will never pull the network shared-origin chunk — the
 * function must remain async and the network import may not be hoisted to a
 * static import without breaking this contract. sdk-core is already statically
 * loaded (top of this file) and its shared-origin wrapper does not import network
 * (the channel is injected), so only network needs to be dynamic.
 */
export async function createSharedOriginConnection(opts: {
  /** The operator's auth origin — the popup to open, and the ONLY origin whose replies are trusted. */
  authOrigin: string;
  storage?: StorageAdapter;
}): Promise<Connection> {
  const { createWebChannel } = await import("@avokjs/network");
  const channel = createWebChannel({ authOrigin: opts.authOrigin });
  // sdk-core's createSharedOriginConnection internally passes storage to
  // @avokjs/network, which expects a synchronous get() → string|null.
  // sdk-core's own StorageAdapter allows async, but all real webStorage() /
  // memoryStorage() implementations are synchronous — narrow the type precisely.
  const storage = (opts.storage ?? webStorage()) as import("@avokjs/network").StorageAdapter;
  // #8: no redirectUri / clientId / scopes. There is no redirect (the popup postMessages back to
  // its opener), no client registration (open/MetaMask-style — anybody can implement the
  // connection), and no scopes. The config is just the origin to open.
  return sdkSharedOrigin({ authOrigin: opts.authOrigin, channel, storage });

  // NO COLD-START VALIDATION, and nothing to replace it with. It existed because a restored session
  // was a bearer TOKEN the operator might refuse — so an app could render as signed-in against a
  // dead session and only find out at signing time, the worst possible moment. What is restored now
  // is a public address: it authorises nothing, the operator holds no session to forget, and there
  // is no server to ask. It cannot go stale, so there is no question worth asking.
}
