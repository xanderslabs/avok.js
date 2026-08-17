import { createSharedOriginConnection as sdkSharedOrigin } from "./engine.js";
import type { StorageAdapter, Connection } from "./engine.js";
import { resolveChainByName } from "@avokjs/contracts";
import type { RpcOverrides } from "@avokjs/contracts";
import { webStorage } from "./web/web-storage.js";

// The client factory, wrapped to announce the EIP-1193 provider on construction
// (VISION §6 Surface 1). See provider-wiring.ts.
export { createAvokClient } from "./web/provider-wiring.js";
export type { WiredAvokClient, WalletInfo } from "./web/provider-wiring.js";
// Compute the EIP-6963 reverse-DNS wallet id from an origin, e.g. "wallet.example.com" ->
// "com.example.wallet". The wiring applies this automatically when `wallet.rdns` is omitted; exported
// so an operator can set it explicitly too.
export { rdnsFromOrigin } from "./provider/index.js";
export type {
  StorageAdapter,
  Connection,
  Account,
  ClientConfig,
  AvokClient,
  CreateOpts,
  ContinueOpts,
  TxOpts,
  EvmFeeToken,
} from "./engine.js";
// The catchable runtime error types, exported as values so apps can `instanceof`-narrow them:
// UnsupportedFeeTokenError (fee token not supported on the target chain), SponsorshipUnavailableError
// (a send asked for sponsorship and the rail is not reachable), UserRejectedError (the user
// pressed Reject in the signing popup), NoPrfError (the passkey provider lacks PRF).
export { UnsupportedFeeTokenError, SponsorshipUnavailableError, UserRejectedError, NoPrfError } from "./engine.js";

// Re-export webStorage so callers can supply the same adapter to other seams.
export { webStorage } from "./web/web-storage.js";

import type { WalletInfo, WiredAvokClient } from "./web/provider-wiring.js";
import { createAvokClient as createWiredAvokClient } from "./web/provider-wiring.js";

/**
 * `createAvok` is the public factory (D3): one config key selects everything. `originPoint` is the
 * operator's vault (theirs, or someone else's — permissionless, open/MetaMask-style); every request
 * this SDK ever makes opens a popup there and nowhere else. There is no `rpId`/`authOrigin` to set —
 * those are the origin-point's OWN build-time config (`avok-vault init`), never this SDK's.
 *
 * Bundle-purity: `@avokjs/core/channel` (createWebChannel) is imported DYNAMICALLY inside this
 * function body, so an app that never calls `createAvok` never pulls the channel chunk.
 */
export async function createAvok(opts: {
  /** The operator's origin-point vault — the popup this SDK opens for every wallet action. */
  originPoint: string;
  /** Registry chain names (e.g. "base", "ethereum") this app intends to use. Validated eagerly so a
   *  typo fails at construction, not on the first send. */
  chains: string[];
  /** White-label identity (operator's brand), announced via EIP-6963. */
  wallet?: WalletInfo;
  /** Opt-in, bring-your-own ERC-7677 sponsorship. Never default-on. */
  sponsorship?: { sponsorUrl: string };
  storage?: StorageAdapter;
  rpcUrls?: RpcOverrides;
}): Promise<WiredAvokClient> {
  // Fail loud on an unknown chain name now, not on the first send to it.
  for (const name of opts.chains) resolveChainByName(name);

  const { createWebChannel } = await import("./channel/index.js");
  const channel = createWebChannel({ originPoint: opts.originPoint });
  // The shared-origin wrapper passes storage straight to @avokjs/core/channel, which expects a
  // synchronous get() -> string|null. Core's own StorageAdapter allows async, but all real
  // webStorage()/memoryStorage() implementations are synchronous — narrow the type precisely.
  const storage = (opts.storage ?? webStorage()) as import("./channel/index.js").StorageAdapter;
  const connection = sdkSharedOrigin({ originPoint: opts.originPoint, channel, storage });

  return createWiredAvokClient(
    {
      connection,
      storage: opts.storage,
      rpcUrls: opts.rpcUrls,
      // The TDD's config surface is deliberately one URL (`sponsorship.sponsorUrl`), not the two
      // separate paymaster/bundler knobs ClientConfig historically exposed — most ERC-7677 providers
      // (Pimlico, Alchemy) serve both roles from the same endpoint, and originPoint config exposes
      // only the one knob an operator actually has to make a decision about.
      paymasterUrl: opts.sponsorship?.sponsorUrl,
      bundlerUrl: opts.sponsorship?.sponsorUrl,
    },
    opts.wallet,
  );
}

/**
 * Lower-level building block behind `createAvok`, exposed for apps that need to assemble their own
 * `ClientConfig` (e.g. a custom channel transport) rather than go through the one-call factory.
 */
export async function createSharedOriginConnection(opts: {
  /** The operator's origin-point vault — the popup to open, and the ONLY origin whose replies are trusted. */
  originPoint: string;
  storage?: StorageAdapter;
}): Promise<Connection> {
  const { createWebChannel } = await import("./channel/index.js");
  const channel = createWebChannel({ originPoint: opts.originPoint });
  const storage = (opts.storage ?? webStorage()) as import("./channel/index.js").StorageAdapter;
  return sdkSharedOrigin({ originPoint: opts.originPoint, channel, storage });

  // NO COLD-START VALIDATION, and nothing to replace it with. It existed because a restored session
  // was a bearer TOKEN the operator might refuse — so an app could render as signed-in against a
  // dead session and only find out at signing time, the worst possible moment. What is restored now
  // is a public address: it authorises nothing, the operator holds no session to forget, and there
  // is no server to ask. It cannot go stale, so there is no question worth asking.
}
