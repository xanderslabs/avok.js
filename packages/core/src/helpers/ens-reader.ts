import type { Address } from "viem";

/** Minimal viem-client seam the reader needs (a real viem PublicClient satisfies this). */
export interface EnsClient {
  getEnsName(args: { address: Address }): Promise<string | null>;
  getEnsAddress(args: { name: string }): Promise<Address | null>;
}

export interface EnsReader {
  resolveAddress(name: string): Promise<Address | null>;
  resolveName(address: Address): Promise<string | null>;
}

/** `chainId` names the chain whose ENS this reads; the injected `client` is already scoped to it. */
export function createEnsReader(opts: { chainId: number; client: EnsClient }): EnsReader {
  return {
    resolveAddress: (name) => opts.client.getEnsAddress({ name }),
    resolveName: (address) => opts.client.getEnsName({ address }),
  };
}
