import { describe, expect, test } from "vitest";
import { getAddress, namehash, zeroAddress } from "viem";
import { createEnsReader } from "../src/ens-reader.js";

const OWNED = namehash("alice.qudiid.eth");

function fakeClient(owners: Record<string, string>, names: Record<string, string>) {
  return {
    readContract: async ({ args }: { args: readonly unknown[] }) =>
      (owners[args[0] as string] ?? zeroAddress) as `0x${string}`,
    getEnsName: async ({ address }: { address: string }) => names[address.toLowerCase()] ?? null,
    getEnsAddress: async () => null,
  };
}

describe("ENS reader", () => {
  test("isAvailable is false when the registry owner is non-zero", async () => {
    const reader = createEnsReader({
      chainId: 1,
      client: fakeClient({ [OWNED]: "0x1111111111111111111111111111111111111111" }, {}) as never,
    });
    expect(await reader.isAvailable("alice.qudiid.eth")).toBe(false);
    expect(await reader.isAvailable("bob.qudiid.eth")).toBe(true);
  });

  test("resolveName returns the reverse-resolved primary name", async () => {
    const addr = getAddress("0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c");
    const reader = createEnsReader({
      chainId: 1,
      client: fakeClient({}, { [addr.toLowerCase()]: "alice.qudiid.eth" }) as never,
    });
    expect(await reader.resolveName(addr)).toBe("alice.qudiid.eth");
  });
});
