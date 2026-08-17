import { describe, expect, test } from "vitest";
import { getAddress } from "viem";
import { createEnsReader } from "../../src/helpers/ens-reader.js";

function fakeClient(names: Record<string, string>) {
  return {
    getEnsName: async ({ address }: { address: string }) => names[address.toLowerCase()] ?? null,
    getEnsAddress: async () => null,
  };
}

describe("ENS reader", () => {
  test("resolveName returns the reverse-resolved primary name", async () => {
    const addr = getAddress("0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c");
    const reader = createEnsReader({
      chainId: 1,
      client: fakeClient({ [addr.toLowerCase()]: "alice.qudiid.eth" }) as never,
    });
    expect(await reader.resolveName(addr)).toBe("alice.qudiid.eth");
  });
});
