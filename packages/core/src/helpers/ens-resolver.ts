import type { Address } from "viem";
import { createEnsReader, type EnsClient } from "./ens-reader.js";
import type { NameResolverService, ForwardResolution } from "./name-port.js";

/** ENS behind the read-only name port. `parent` only shapes `suffix`; resolution works without it. */
export function createEnsResolver(opts: { chainId: number; parent?: string; client: EnsClient }): NameResolverService {
  const reader = createEnsReader({ chainId: opts.chainId, client: opts.client });
  return {
    suffix: opts.parent ? `.${opts.parent}` : ".eth",
    async resolveForward(name): Promise<ForwardResolution | null> {
      const evm = await reader.resolveAddress(name);
      return evm ? { evm } : null;
    },
    resolveReverse: (address) => reader.resolveName(address as Address),
  };
}
