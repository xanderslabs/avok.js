import { describe, it, expect, vi } from "vitest";

const resolveDomain = vi.fn();
const getPrimaryDomain = vi.fn();
vi.mock("./sns-sdk.js", () => ({ resolveDomain, getPrimaryDomain }));

const { createSnsResolver } = await import("./sns-resolver.js");

const SOL = "So11111111111111111111111111111111111111112";

describe("createSnsResolver", () => {
  it("owns the .sol suffix", () => {
    expect(createSnsResolver({ rpc: {} }).suffix).toBe(".sol");
  });

  it("forward-resolves a .sol domain to its owner", async () => {
    resolveDomain.mockResolvedValueOnce(SOL);
    expect(await createSnsResolver({ rpc: {} }).resolveForward("toly.sol")).toEqual({ solana: SOL });
  });

  it("returns null for an unregistered domain", async () => {
    // WHY: the SDK THROWS for unregistered names rather than returning null; if that throw
    // escaped, an unresolvable recipient would crash the caller instead of showing "not found".
    resolveDomain.mockRejectedValueOnce(new Error("Domain not found"));
    expect(await createSnsResolver({ rpc: {} }).resolveForward("nope.sol")).toBeNull();
  });

  it("reverse-resolves an address to its primary domain", async () => {
    getPrimaryDomain.mockResolvedValueOnce({ domainName: "toly.sol", domainAddress: "x", stale: false });
    expect(await createSnsResolver({ rpc: {} }).resolveReverse(SOL)).toBe("toly.sol");
  });

  it("returns null when the address has no primary domain", async () => {
    getPrimaryDomain.mockRejectedValueOnce(new Error("no primary"));
    expect(await createSnsResolver({ rpc: {} }).resolveReverse(SOL)).toBeNull();
  });
});
