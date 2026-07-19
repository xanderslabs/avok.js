import { describe, expect, test, it } from "vitest";
import { namehash } from "viem";
import { normalizeSubname, subnameNamehash, fullName, subnameNode } from "../../src/helpers/name.js";

describe("subname name helpers", () => {
  test("normalizeSubname lowercases/normalizes per ENS", () => {
    expect(normalizeSubname("Alice")).toBe("alice");
  });

  test("subnameNamehash = ENS namehash of the full name (pinned vector)", () => {
    expect(subnameNamehash("alice.qudi.fi")).toBe("0x5d077f46d9863aec184a3bdc365c9c4fc1309858a9ad820a428143ada006c2a0");
  });

  test("fullName composes normalized label + parent", () => {
    expect(fullName("Alice", "qudiid.eth")).toBe("alice.qudiid.eth");
  });

  test("subnameNode(parentNode,label) === namehash(label.parent)", () => {
    const parent = "qudiid.eth";
    expect(subnameNode(namehash(parent), "alice")).toBe(namehash(`alice.${parent}`));
  });
});

describe("name utilities (moved from avokname in #6)", () => {
  it("normalizes ENS-style before composing a full name", () => {
    // WHY: the voucher signer (subnames/server) and the mint builder (subnames) must agree
    // byte-for-byte, or a valid voucher mints a different label than the operator signed.
    expect(fullName("Alice", "myapp.eth")).toBe("alice.myapp.eth");
  });

  it("subnameNamehash matches viem namehash for the composed name", () => {
    expect(subnameNamehash("alice.myapp.eth")).toBe(namehash("alice.myapp.eth"));
  });

  it("subnameNode composes EIP-137 subnodes from a parent node", () => {
    expect(subnameNode(namehash("myapp.eth"), "alice")).toBe(namehash("alice.myapp.eth"));
  });
});
