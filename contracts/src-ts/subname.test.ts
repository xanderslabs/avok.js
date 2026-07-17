import { describe, expect, test } from "vitest";
import { AvokSubnameRegistrarABI } from "./subname.js";

describe("AvokSubnameRegistrar ABI", () => {
  test("exposes registerWithVoucher + claim", () => {
    const names = AvokSubnameRegistrarABI.filter((f) => f.type === "function").map((f) => (f as { name: string }).name);
    expect(names).toContain("registerWithVoucher");
    expect(names).toContain("claim");
  });

  test("exposes the mint-fee views/setters", () => {
    const names = AvokSubnameRegistrarABI.filter((f) => f.type === "function").map((f) => (f as { name: string }).name);
    expect(names).toContain("mintFee");
    expect(names).toContain("setFee");
    expect(names).toContain("setTreasury");
  });
});
