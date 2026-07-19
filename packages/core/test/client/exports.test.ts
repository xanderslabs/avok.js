import { describe, it, expectTypeOf } from "vitest";
import type { FeeToken, SolanaTxOpts, SolanaNamespace } from "../../src/index.js";

describe("sdk-core Solana type surface", () => {
  it("exports FeeToken with the registry shape", () => {
    expectTypeOf<FeeToken>().toMatchTypeOf<{
      symbol: string;
      mint: string;
      decimals: number;
      tokenProgram: string;
    }>();
    // Presence-only assertions for the already-exported types.
    expectTypeOf<SolanaTxOpts>().not.toBeAny();
    expectTypeOf<SolanaNamespace>().not.toBeAny();
  });
});
