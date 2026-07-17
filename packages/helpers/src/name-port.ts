import type { Address } from "viem";

/** A name's forward resolution — may carry both chains (ENS coinType-501 enrichment). */
export interface ForwardResolution {
  evm?: Address;
  solana?: string;
}

/**
 * The READ half of the old avokname `NameService` port. Registration (buildMint/buildSetPrimary)
 * lives in the optional @avokjs/subnames add-on and is deliberately NOT part of this
 * interface — resolution must work with the add-on uninstalled.
 */
export interface NameResolverService {
  /** The suffix this service owns, lowercase incl. dot: ".eth" or ".sol" (or an operator ENS parent). */
  readonly suffix: string;
  resolveForward(name: string): Promise<ForwardResolution | null>;
  resolveReverse(address: string): Promise<string | null>;
}
