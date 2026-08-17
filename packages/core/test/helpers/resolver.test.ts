import { describe, it, expect } from "vitest";
import { createNameResolver } from "../../src/helpers/resolver.js";
import type { NameResolverService } from "../../src/helpers/name-port.js";

const EVM = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

function fakeEns(over: Partial<NameResolverService> = {}): NameResolverService {
  return {
    suffix: ".eth",
    resolveForward: async (n) => (n === "alice.eth" ? { evm: EVM as `0x${string}` } : null),
    resolveReverse: async () => "alice.eth",
    ...over,
  };
}

describe("createNameResolver", () => {
  it("resolves a name forward through the configured service", async () => {
    const r = createNameResolver({ ens: fakeEns() });
    expect(await r.resolveForward("alice.eth")).toEqual({ evm: EVM });
  });

  it("returns null when no service is configured", async () => {
    const r = createNameResolver({});
    expect(await r.resolveForward("alice.eth")).toBeNull();
  });

  it("resolves an address in reverse", async () => {
    const r = createNameResolver({ ens: fakeEns() });
    expect(await r.resolveReverse(EVM)).toBe("alice.eth");
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
