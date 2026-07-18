import type { Address } from "viem";
import type { Call, Receipt } from "../evm/index.js";
import { createEvmNamespace, type EvmFeeToken } from "../client/evm.js";
import type { ClientConfig } from "../types.js";

/** Per-chain capabilities the provider surfaces via `wallet_getCapabilities`. */
export interface EngineCapabilities {
  /** Sponsored (4337) is available when this deployment has BOTH a bundler and a 7677 paymaster. */
  paymasterService: { supported: boolean };
  /** The chain's registry fee tokens — the fee-token picker's option list. */
  feeTokens: EvmFeeToken[];
}

/**
 * The send/status surface the EIP-1193 provider drives. It is the EXISTING EVM engine
 * (`createEvmNamespace`) built from the client config — no behavior change, and no dependency on the
 * public `client.evm` namespace (which a later step deletes). The provider is a separate package, so
 * this is reached through the `@avokjs/sdk-core/internal` subpath, not the main surface.
 */
export interface SendEngine {
  send(calls: Call[], opts: { chainId: number; feeToken?: Address | null }): Promise<Receipt>;
  /** A SINGLE, non-blocking status poll — for `wallet_getCallsStatus`. */
  status(receipt: Receipt): Promise<Receipt>;
  /** Per-chain sponsored support + fee tokens — for `wallet_getCapabilities`. */
  capabilities(chainId: number): EngineCapabilities;
}

export function createSendEngine(config: ClientConfig): SendEngine {
  const evm = createEvmNamespace(config);
  // Sponsored needs BOTH a bundler and a 7677 paymaster (matches evm.ts `canSponsor`).
  const sponsoredSupported = Boolean(
    (config.paymasterUrl || config.deps?.paymaster) && (config.bundlerUrl || config.deps?.bundler),
  );
  return {
    send: (calls, opts) => evm.send(calls, opts),
    // timeoutMs:0 makes evm.wait poll once and return immediately (see evm.ts `wait`).
    status: (receipt) => evm.wait(receipt, { timeoutMs: 0, intervalMs: 0 }),
    capabilities: (chainId) => ({
      paymasterService: { supported: sponsoredSupported },
      feeTokens: sponsoredSupported ? evm.feeTokens(chainId) : [],
    }),
  };
}
