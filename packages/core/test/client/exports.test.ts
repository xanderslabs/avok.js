import { describe, it, expect, expectTypeOf } from "vitest";
import type { FeeToken, SolanaTxOpts, SolanaNamespace } from "../../src/index.js";
import * as api from "../../src/index.js";

describe("catchable error surface", () => {
  // The runtime errors a consumer handles by `instanceof` must be reachable from the main @avokjs/core
  // barrel. MissingRpIdError is deliberately absent — it is a fail-fast config error, not caught.
  it("exposes the catchable error classes and NOT the config fail-fast error", () => {
    for (const name of [
      "UnsupportedFeeTokenError", "UserRejectedError", "NoPrfError",
      "KoraRejectedError", "EnrolmentUnaffordableError", "VaultUnreadableError",
    ]) {
      expect(api, `missing error export: ${name}`).toHaveProperty(name);
      expect((api as Record<string, unknown>)[name]).toBeTypeOf("function");
    }
    expect(api).not.toHaveProperty("MissingRpIdError");
  });
});

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
