import type { NameResolverService, ForwardResolution } from "./name-port.js";

export interface NameResolver {
  resolveForward(name: string): Promise<ForwardResolution | null>;
  resolveReverse(address: string): Promise<string | null>;
}

/**
 * Cross-service resolver. Forward and reverse both dispatch to the one configured service, and
 * reverse carries a forward-verification trust anchor: a reverse hit is only returned if
 * forward-resolving it maps back to the queried address.
 *
 * It stays a `{ ens }` OBJECT rather than a bare service parameter because the port is the point.
 * `NameResolverService` owns a suffix, so an operator resolving names under its own ENS parent plugs
 * in here without a code change, and a second namespace is one more key rather than a rewrite.
 */
export function createNameResolver(opts: { ens?: NameResolverService; verifyReverse?: boolean }): NameResolver {
  const verify = opts.verifyReverse ?? true;

  return {
    async resolveForward(name: string): Promise<ForwardResolution | null> {
      return opts.ens ? opts.ens.resolveForward(name) : null;
    },

    async resolveReverse(address: string): Promise<string | null> {
      const svc = opts.ens;
      if (!svc) return null;
      const name = await svc.resolveReverse(address);
      if (!name || !verify) return name;
      // Trust anchor: the candidate name must forward-resolve back to this address.
      const fwd = await svc.resolveForward(name);
      const back = fwd?.evm;
      return back && back.toLowerCase() === address.toLowerCase() ? name : null;
    },
  };
}
