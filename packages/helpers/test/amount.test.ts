import { describe, it, expect } from "vitest";
import { formatAmount } from "../src/amount.js";

describe("formatAmount", () => {
  it("formats whole USDC (6dp)", () => {
    expect(formatAmount(1_000_000n, 6)).toBe("1.00");
  });
  it("trims trailing zeros below 1", () => {
    expect(formatAmount(42_000n, 6)).toBe("0.042");
  });
  it("adds thousands separators", () => {
    expect(formatAmount(1_234_567_000_000n, 6)).toBe("1,234,567.00");
  });
  it("handles zero", () => {
    expect(formatAmount(0n, 6)).toBe("0");
  });
  it("handles negatives", () => {
    expect(formatAmount(-1_500_000n, 6)).toBe("-1.50");
  });
});
