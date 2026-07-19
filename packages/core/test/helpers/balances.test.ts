import { describe, it, expect, vi } from "vitest";

// Mock @solana/kit's RPC: 2 SOL native, and 5 USDC (6dp) in the derived ATA.
//
// SPL balances are read by DERIVING the associated token account and batching them into ONE
// getMultipleAccounts — never getTokenAccountsByOwner, which is an indexed owner-scan that free
// Solana endpoints refuse (they hang on it forever, so balances silently read 0).
vi.mock("@solana/kit", async (orig) => {
  const real = await orig<typeof import("@solana/kit")>();
  return {
    ...real,
    createSolanaRpc: () => ({
      getBalance: () => ({ send: async () => ({ value: 2_000_000_000n }) }),
      getMultipleAccounts: (addrs: string[]) => ({
        send: async () => ({
          value: addrs.map(() => ({ data: { parsed: { info: { tokenAmount: { amount: "5000000" } } } } })),
        }),
      }),
      // REGRESSION GUARD. Calling this again would silently break token balances on every free RPC:
      // the indexed owner-scan is the one question public Solana endpoints refuse, and they refuse
      // it by HANGING — no response, no error — so balances would just quietly read 0 forever.
      getTokenAccountsByOwner: () => {
        throw new Error(
          "getTokenAccountsByOwner is an indexed owner-scan that free Solana endpoints refuse (they hang). " +
            "Derive the ATA from the registry mint and batch getMultipleAccounts instead.",
        );
      },
    }),
  };
});

import { readSolanaBalances } from "../../src/helpers/balances.js";

describe("readSolanaBalances", () => {
  it("returns native SOL first, then SPL tokens with summed balances", async () => {
    const out = await readSolanaBalances("mainnet", "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
    expect(out[0].symbol).toBe("SOL");
    expect(out[0].base).toBe(2_000_000_000n);
    expect(out[0].formatted).toBe("2.00");
    const usdc = out.find((b) => b.symbol === "USDC");
    expect(usdc?.base).toBe(5_000_000n);
    expect(usdc?.formatted).toBe("5.00");
  });
});
