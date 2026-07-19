import { describe, it, expect } from "vitest";
import { evmExplorerTxUrl, solanaExplorerTxUrl } from "./explorers.js";

describe("explorers", () => {
  it("builds Base Sepolia tx url", () => {
    expect(evmExplorerTxUrl(84532, "0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
  });
  it("builds Base mainnet tx url", () => {
    expect(evmExplorerTxUrl(8453, "0xabc")).toBe("https://basescan.org/tx/0xabc");
  });
  it("builds Arc testnet tx url", () => {
    expect(evmExplorerTxUrl(5042002, "0xabc")).toBe("https://testnet.arcscan.app/tx/0xabc");
  });
  it("falls back to a generic explorer for unknown chains", () => {
    expect(evmExplorerTxUrl(999999, "0xabc")).toContain("0xabc");
  });
  it("builds Solana devnet explorer url with cluster query", () => {
    expect(solanaExplorerTxUrl("devnet", "sig1")).toBe(
      "https://explorer.solana.com/tx/sig1?cluster=devnet",
    );
  });
  it("omits cluster query on mainnet", () => {
    expect(solanaExplorerTxUrl("mainnet", "sig1")).toBe("https://explorer.solana.com/tx/sig1");
  });
});
