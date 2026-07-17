import type { NameResolverService, ForwardResolution } from "./name-port.js";

export interface NameResolver {
  resolveForward(name: string): Promise<ForwardResolution | null>;
  resolveReverse(address: string): Promise<string | null>;
}

/** An EVM address is 0x + 40 hex chars; anything else is treated as a Solana pubkey. */
function isEvmAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/**
 * Cross-service resolver. Forward = suffix-dispatch (works for subnames AND arbitrary external
 * ENS/SNS names). Reverse = address-type-dispatch, with a forward-verification trust anchor: a
 * reverse hit is only returned if forward-resolving it maps back to the queried address.
 */
export function createNameResolver(opts: {
  ens?: NameResolverService;
  sns?: NameResolverService;
  verifyReverse?: boolean;
}): NameResolver {
  const verify = opts.verifyReverse ?? true;

  return {
    async resolveForward(name: string): Promise<ForwardResolution | null> {
      const svc = name.toLowerCase().endsWith(".sol") ? opts.sns : opts.ens;
      return svc ? svc.resolveForward(name) : null;
    },

    async resolveReverse(address: string): Promise<string | null> {
      const evm = isEvmAddress(address);
      const svc = evm ? opts.ens : opts.sns;
      if (!svc) return null;
      const name = await svc.resolveReverse(address);
      if (!name || !verify) return name;
      // Trust anchor: the candidate name must forward-resolve back to this address.
      const fwd = await svc.resolveForward(name);
      const back = evm ? fwd?.evm : fwd?.solana;
      return back && back.toLowerCase() === address.toLowerCase() ? name : null;
    },
  };
}
