import type { Address } from "viem";

/** A name's forward resolution — may carry both chains (ENS coinType-501 enrichment). */
export interface ForwardResolution {
  evm?: Address;
  solana?: string;
}

/**
 * The READ half of the old avokname `NameService` port. This is resolution only — name
 * REGISTRATION/minting is deliberately out of scope for Avok (removed with the subname add-on),
 * so it is not part of this interface. Resolution stands alone.
 */
export interface NameResolverService {
  /** The suffix this service owns, lowercase incl. dot: ".eth" or ".sol" (or an operator ENS parent). */
  readonly suffix: string;
  resolveForward(name: string): Promise<ForwardResolution | null>;
  resolveReverse(address: string): Promise<string | null>;
}
