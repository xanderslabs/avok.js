import { describe, it, expect } from "vitest";
import { dangerousPrimaryType, isUnlimitedAmount, UNLIMITED_THRESHOLD } from "../../src/auth-popup/sign/danger.js";

describe("dangerousPrimaryType", () => {
  it("flags ERC-2612 Permit, a signature that grants spending with no transaction", () => {
    expect(dangerousPrimaryType("Permit")).toMatch(/spend/i);
  });

  it("flags every Permit2 shape", () => {
    for (const t of ["PermitSingle", "PermitBatch", "PermitTransferFrom", "PermitBatchTransferFrom"]) {
      expect(dangerousPrimaryType(t)).not.toBeNull();
    }
  });

  it("returns null for an ordinary primary type", () => {
    expect(dangerousPrimaryType("Order")).toBeNull();
    expect(dangerousPrimaryType("Mail")).toBeNull();
  });

  it("matches case-sensitively, so a lookalike is not silently treated as known", () => {
    expect(dangerousPrimaryType("permit")).toBeNull();
  });

  // A table keyed by a plain object is reachable through the prototype: `dangerousPrimaryType`
  // must answer about the TABLE, not about Object.prototype.
  it("is not confused by inherited property names", () => {
    expect(dangerousPrimaryType("constructor")).toBeNull();
    expect(dangerousPrimaryType("toString")).toBeNull();
    expect(dangerousPrimaryType("__proto__")).toBeNull();
  });
});

describe("isUnlimitedAmount", () => {
  it("catches the 2^256-1 encoding", () => {
    expect(isUnlimitedAmount((2n ** 256n - 1n).toString())).toBe(true);
  });

  it("catches the 2^255 encoding", () => {
    expect(isUnlimitedAmount((2n ** 255n).toString())).toBe(true);
  });

  it("catches Permit2's uint160 max, which the uint256 threshold would miss", () => {
    expect(isUnlimitedAmount((2n ** 160n - 1n).toString())).toBe(true);
  });

  it("leaves a large but real approval alone", () => {
    // 1 billion tokens at 18 decimals. Big, and a number a person could mean.
    expect(isUnlimitedAmount((10n ** 27n).toString())).toBe(false);
  });

  it("keeps the documented uint256 threshold available", () => {
    expect(UNLIMITED_THRESHOLD).toBe(2n ** 255n);
  });

  // Input reaches this from a decoded payload, so it is not guaranteed to be a number at all.
  // Guessing "dangerous" on garbage would cry wolf; guessing "safe" is the quieter, honest answer,
  // because an amount that cannot be parsed is also one the renderer will show verbatim.
  it("says no rather than throwing on something that is not a number", () => {
    for (const bad of ["", "abc", "1.5", "0x", " ", "-1e30"]) {
      expect(() => isUnlimitedAmount(bad)).not.toThrow();
      expect(isUnlimitedAmount(bad)).toBe(false);
    }
  });

  it("handles a hex-encoded amount, which is how calldata carries it", () => {
    expect(isUnlimitedAmount(`0x${"f".repeat(64)}`)).toBe(true);
  });
});
