import { getAddress, namehash, zeroAddress, type Address } from "viem";
import { getEnsDeployment } from "@avokjs/contracts";

const ENS_REGISTRY_ABI = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;

/** Minimal viem-client seam the reader needs (a real viem PublicClient satisfies this). */
export interface EnsClient {
  readContract(args: {
    address: Address;
    abi: typeof ENS_REGISTRY_ABI;
    functionName: "owner";
    args: readonly [`0x${string}`];
  }): Promise<Address>;
  getEnsName(args: { address: Address }): Promise<string | null>;
  getEnsAddress(args: { name: string }): Promise<Address | null>;
}

export interface EnsReader {
  isAvailable(name: string): Promise<boolean>;
  resolveAddress(name: string): Promise<Address | null>;
  resolveName(address: Address): Promise<string | null>;
}

export function createEnsReader(opts: { chainId: number; client: EnsClient }): EnsReader {
  const registry = getAddress(getEnsDeployment(opts.chainId).registry);
  return {
    async isAvailable(name) {
      const owner = await opts.client.readContract({
        address: registry,
        abi: ENS_REGISTRY_ABI,
        functionName: "owner",
        args: [namehash(name)],
      });
      return getAddress(owner) === zeroAddress;
    },
    resolveAddress: (name) => opts.client.getEnsAddress({ name }),
    resolveName: (address) => opts.client.getEnsName({ address }),
  };
}
