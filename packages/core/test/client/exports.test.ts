import { describe, it, expect } from "vitest";
import * as api from "../../src/index.js";

describe("catchable error surface", () => {
  // The runtime errors a consumer handles by `instanceof` must be reachable from the main @avokjs/core
  // barrel. MissingRpIdError is deliberately absent — it is a fail-fast config error, not caught.
  it("exposes the catchable error classes and NOT the config fail-fast error", () => {
    for (const name of ["UnsupportedFeeTokenError", "SponsorshipUnavailableError", "UserRejectedError", "NoPrfError"]) {
      expect(api, `missing error export: ${name}`).toHaveProperty(name);
      expect((api as Record<string, unknown>)[name]).toBeTypeOf("function");
    }
    expect(api).not.toHaveProperty("MissingRpIdError");
  });
});
