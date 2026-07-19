import { describe, expect, it } from "vitest";
import { railFromContext } from "./types.js";

describe("railFromContext", () => {
  it("sponsored when a feeToken mint is present, self-pay otherwise", () => {
    expect(railFromContext({ cluster: "mainnet", feeToken: "EPjF…mint" })).toBe("sponsored");
    expect(railFromContext({ cluster: "mainnet" })).toBe("self-pay");
    expect(railFromContext({ cluster: "mainnet", feeToken: null })).toBe("self-pay");
  });
});
