import { resolveDomain, getPrimaryDomain, type SnsRpc } from "./sns-sdk.js";
import type { NameResolverService, ForwardResolution } from "./name-port.js";

export type { SnsRpc };

/**
 * SNS behind the read-only name port. Reads use the kit-native sns-sdk-kit, whose resolveDomain
 * THROWS for unregistered names — hence the catch-to-null. Reverse forward-verification is applied
 * by the cross-service resolver, not here. Minting is out of scope for Avok (no registration).
 */
export function createSnsResolver(opts: { rpc: SnsRpc }): NameResolverService {
  return {
    suffix: ".sol",
    async resolveForward(name: string): Promise<ForwardResolution | null> {
      const solana = await resolveDomain({ rpc: opts.rpc, domain: name }).catch(() => null);
      return solana ? { solana: String(solana) } : null;
    },
    async resolveReverse(addr: string): Promise<string | null> {
      const primary = await getPrimaryDomain({ rpc: opts.rpc, walletAddress: addr }).catch(() => null);
      return primary ? primary.domainName : null;
    },
  };
}
