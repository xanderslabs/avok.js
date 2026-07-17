import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import type { Connection } from "../src/types.js";
import { createSolanaNamespace } from "../src/client/solana.js";

/** Minimal Connection double — feeTokens never touches the connection. */
function makeFakeConnection(): Connection {
  return {
    account: () => ({
      evm: { address: "0x1111111111111111111111111111111111111111" as Address },
      solana: { address: "11111111111111111111111111111111" },
    }),
    status: () => true,
  } as unknown as Connection;
}

describe("client.feeTokens", () => {
  it("filters listFeeTokens to solana + mainnet", () => {
    const client = createSolanaNamespace({ connection: makeFakeConnection() });
    const tokens = client.feeTokens("mainnet");
    expect(tokens.every((t) => typeof t.mint === "string" && typeof t.decimals === "number")).toBe(true);
    expect(tokens.some((t) => t.symbol === "USDC")).toBe(true);
  });

  it("filters listFeeTokens to solana + devnet", () => {
    const client = createSolanaNamespace({ connection: makeFakeConnection() });
    const tokens = client.feeTokens("devnet");
    expect(tokens.some((t) => t.symbol === "USDC")).toBe(true);
  });

  it("throws when no cluster is available", () => {
    const client = createSolanaNamespace({ connection: makeFakeConnection() });
    expect(() => client.feeTokens()).toThrow(/cluster/i);
  });
});
