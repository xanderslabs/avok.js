import { describe, it, expect } from "vitest";
import { evmChains, getChain, chainName, solanaTokens } from "./chains.js";

describe("chains", () => {
  it("includes testnets (Arc 5042002 present)", () => {
    expect(evmChains.some((c) => c.id === 5042002)).toBe(true);
  });
  it("names known chains", () => {
    expect(chainName(8453)).toBe("Base");
    expect(chainName(5042002)).toBe("Arc");
  });
  it("shows the registry display name, not the raw id (BSC, Robinhood)", () => {
    expect(chainName(56)).toBe("BSC");
    expect(chainName(4663)).toBe("Robinhood");
  });
  it("each chain carries an explorer tx builder", () => {
    const base = getChain(8453);
    expect(base?.explorerTxUrl("0xabc")).toBe("https://basescan.org/tx/0xabc");
    expect(getChain(5042002)?.explorerTxUrl("0xabc")).toBe("https://testnet.arcscan.app/tx/0xabc");
  });
});

describe("solanaTokens", () => {
  it("lists native SOL first, then the cluster's registry SPL tokens", () => {
    const toks = solanaTokens("mainnet");
    expect(toks[0]).toMatchObject({ symbol: "SOL", mint: null, decimals: 9 });
    expect(toks.some((t) => t.symbol === "USDC" && typeof t.mint === "string")).toBe(true);
  });
});
