import { getAddress, type Address } from "viem";
import { getEnsDeployment } from "@avokjs/contracts";
import { createEnsReader, subnameNamehash, fullName, type EnsClient } from "@avokjs/helpers";
import {
  createVoucherRegistrarCallBuilder,
  buildSetPrimaryNameCall,
  buildSetSolanaAddrCall,
  type Call,
} from "./registrar.js";
import type { NameMint, NameMintInput } from "./port.js";

/** The ENS write adapter: availability (a registration-support read) + the mint/set-primary builders. */
export interface EnsRegistrar {
  readonly suffix: string;
  isAvailable(name: string): Promise<boolean>;
  buildMint(input: NameMintInput): NameMint;
  buildSetPrimary(args: { name: string; chainId?: number }): NameMint;
}

/**
 * ENS registration adapter. Wraps helpers' reader (for availability) + the registrar builders and,
 * on mint, enriches with the coinType-501 Solana-address record (when a solanaAddress is supplied)
 * so one ENS name forward-resolves to both chains.
 *
 * Resolution lives in @avokjs/helpers (createEnsResolver) — this adapter never resolves.
 */
export function createEnsRegistrar(opts: {
  chainId: number;
  /** Required only for minting (buildMint) + the operator suffix. isAvailable works without it. */
  parent?: string;
  /** Required only for minting (buildMint). isAvailable works without it. */
  registrar?: Address;
  client: EnsClient;
}): EnsRegistrar {
  const reader = createEnsReader({ chainId: opts.chainId, client: opts.client });
  const resolver = getAddress(getEnsDeployment(opts.chainId).publicResolver);

  return {
    suffix: opts.parent ? `.${opts.parent}` : ".eth",

    isAvailable: (name) => reader.isAvailable(name),

    buildMint(input: NameMintInput): NameMint {
      if (!opts.parent) throw new Error("ENS buildMint requires a parent");
      if (!opts.registrar) throw new Error("ENS buildMint requires a registrar");
      if (!input.voucher || !input.signature) {
        throw new Error("ENS buildMint requires a voucher + signature");
      }
      const builder = createVoucherRegistrarCallBuilder(opts.registrar);
      const calls: Call[] = [builder.buildMintCall({ voucher: input.voucher, signature: input.signature })];
      if (input.solanaAddress) {
        const node = subnameNamehash(fullName(input.voucher.label, opts.parent));
        calls.push(buildSetSolanaAddrCall(resolver, node, input.solanaAddress));
      }
      return { chain: "evm", calls };
    },

    buildSetPrimary({ name, chainId }): NameMint {
      return { chain: "evm", calls: [buildSetPrimaryNameCall(chainId ?? opts.chainId, name)] };
    },
  };
}
