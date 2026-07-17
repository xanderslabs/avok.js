import { describe, expect, it } from "vitest";
import { railFromContext } from "../src/types.js";

describe("railFromContext", () => {
  it("fronted when a feeToken mint is present, self-pay otherwise", () => {
    expect(railFromContext({ cluster: "mainnet", feeToken: "EPjF…mint" })).toBe("fronted");
    expect(railFromContext({ cluster: "mainnet" })).toBe("self-pay");
    expect(railFromContext({ cluster: "mainnet", feeToken: null })).toBe("self-pay");
  });
});
