import { describe, it, expect } from "vitest";
import { createNameResolver } from "../src/resolver.js";
import type { NameResolverService } from "../src/name-port.js";

const EVM = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const SOL = "So11111111111111111111111111111111111111112";

function fakeEns(over: Partial<NameResolverService> = {}): NameResolverService {
  return {
    suffix: ".eth",
    resolveForward: async (n) => (n === "alice.eth" ? { evm: EVM as `0x${string}` } : null),
    resolveReverse: async () => "alice.eth",
    ...over,
  };
}
function fakeSns(over: Partial<NameResolverService> = {}): NameResolverService {
  return {
    suffix: ".sol",
    resolveForward: async (n) => (n === "toly.sol" ? { solana: SOL } : null),
    resolveReverse: async () => "toly.sol",
    ...over,
  };
}

describe("createNameResolver", () => {
  it("dispatches forward resolution on the suffix", async () => {
    const r = createNameResolver({ ens: fakeEns(), sns: fakeSns() });
    expect(await r.resolveForward("alice.eth")).toEqual({ evm: EVM });
    expect(await r.resolveForward("toly.sol")).toEqual({ solana: SOL });
  });

  it("returns null when the owning service is not configured", async () => {
    const r = createNameResolver({ ens: fakeEns() });
    expect(await r.resolveForward("toly.sol")).toBeNull();
  });

  it("dispatches reverse resolution on the address type", async () => {
    const r = createNameResolver({ ens: fakeEns(), sns: fakeSns() });
    expect(await r.resolveReverse(EVM)).toBe("alice.eth");
    expect(await r.resolveReverse(SOL)).toBe("toly.sol");
  });

  it("REJECTS a reverse hit that does not forward-resolve back to the queried address", async () => {
    // WHY: reverse records are self-asserted. Without this trust anchor, anyone could set a
    // reverse record claiming a name they do not own and have the UI render it as theirs.
    const r = createNameResolver({ ens: fakeEns({ resolveReverse: async () => "mallory.eth" }) });
    expect(await r.resolveReverse(EVM)).toBeNull();
  });

  it("skips forward-verification when verifyReverse is false", async () => {
    const r = createNameResolver({
      ens: fakeEns({ resolveReverse: async () => "mallory.eth" }),
      verifyReverse: false,
    });
    expect(await r.resolveReverse(EVM)).toBe("mallory.eth");
  });

  it("rejects a reverse hit that forward-resolves to a DIFFERENT address", async () => {
    const r = createNameResolver({
      ens: fakeEns({ resolveForward: async () => ({ evm: OTHER as `0x${string}` }) }),
    });
    expect(await r.resolveReverse(EVM)).toBeNull();
  });
});
