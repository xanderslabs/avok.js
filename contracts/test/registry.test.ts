import { describe, it, expect } from "vitest";
import { getChainProfile } from "../src-ts/registry.js";

describe("chain display names", () => {
  it("names BSC and Robinhood the way users expect (not the raw id)", () => {
    expect(getChainProfile(56)?.name).toBe("BSC");
    expect(getChainProfile(4663)?.name).toBe("Robinhood");
  });
  it("every EVM profile carries a non-empty display name", () => {
    for (const id of [1, 10, 42161, 56, 8453, 4663, 5042002, 11155111]) {
      expect(getChainProfile(id)?.name?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
