import { describe, it, expect } from "vitest";
import { txReduce, type TxState } from "../../src/helpers/tx-status.js";

describe("txReduce", () => {
  it("drives the happy path idle→signing→pending→confirmed", () => {
    let s: TxState = "idle";
    s = txReduce(s, "submit"); expect(s).toBe("signing");
    s = txReduce(s, "signed"); expect(s).toBe("pending");
    s = txReduce(s, "mined");  expect(s).toBe("confirmed");
  });
  it("goes to failed on revert while pending", () => {
    expect(txReduce("pending", "revert")).toBe("failed");
  });
  it("goes to failed on reject while signing", () => {
    expect(txReduce("signing", "reject")).toBe("failed");
  });
  it("reset returns to idle from any terminal state", () => {
    expect(txReduce("confirmed", "reset")).toBe("idle");
    expect(txReduce("failed", "reset")).toBe("idle");
  });
  it("ignores nonsensical transitions (mined while idle stays idle)", () => {
    expect(txReduce("idle", "mined")).toBe("idle");
  });
});
