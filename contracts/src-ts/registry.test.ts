import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  getChainProfile,
  getTokenProfile,
  getChainProfileById,
  listChains,
  listFeeTokens,
  resolveAnchorChain,
  DEFAULT_ANCHOR_CHAIN_ID,
  CHAIN_NAME_TO_ID,
  resolveChainByName,
  chainIdNumberByName,
  CHAIN_PROFILES,
} from "./registry.js";

describe("chain registry (§8)", () => {
  it("exposes Optimism with capability flags", () => {
    const op = getChainProfile(10);
    expect(op).toBeDefined();
    expect(op!.capabilities.simulateV1).toBe(true);
    expect(typeof op!.capabilities.multicall).toBe("boolean");
    expect(typeof op!.capabilities.sameAssetGas).toBe("boolean");
    expect(typeof op!.capabilities.stateOverride).toBe("boolean");
  });

  it("looks up a token profile case-insensitively", () => {
    const op = getChainProfile(10)!;
    const [addr] = Object.keys(op.tokens) as `0x${string}`[];
    const found = getTokenProfile(10, addr.toUpperCase() as `0x${string}`);
    expect(found).toEqual(op.tokens[addr]);
  });

  it("returns undefined for an unknown chain", () => {
    expect(getChainProfile(999999)).toBeUndefined();
  });
});

describe("registry cohesion", () => {
  it("keeps the EVM profile byte-identical and tags it kind/id", () => {
    const op = getChainProfile(10)!;
    expect(op.kind).toBe("evm");
    expect(op.id).toBe("eip155:10");
    expect(op.chainId).toBe(10);
  });

  it("resolves a chain by id and narrows on kind", () => {
    expect(getChainProfileById("eip155:8453")!.kind).toBe("evm");
    expect(getChainProfileById("eip155:99999")).toBeUndefined();
  });

  it("lists chains and fee tokens (the umbrella surface)", () => {
    const kinds = new Set(listChains().map((c) => c.kind));
    expect(kinds.has("evm")).toBe(true);
    const tokens = listFeeTokens();
    expect(tokens.some((t) => t.chainId === "eip155:10")).toBe(true);
  });
});

describe("multi-chain expansion (Task 2): Ethereum, Arbitrum, BSC + USDT", () => {
  it("adds Ethereum (chainId 1) with the canonical implementation set, and USDC+USDT", () => {
    const eth = getChainProfile(1);
    expect(eth).toBeDefined();
    expect(eth!.kind).toBe("evm");
    expect(eth!.chainId).toBe(1);
    expect(eth!.canonicalImplementation).toBe("0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e");
    const tokens = Object.values(eth!.tokens);
    const usdc = tokens.find((t) => t.symbol === "USDC")!;
    expect(usdc.address).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    expect(usdc.decimals).toBe(6);
    const usdt = tokens.find((t) => t.symbol === "USDT")!;
    expect(usdt.address).toBe("0xdAC17F958D2ee523a2206206994597C13D831ec7");
    expect(usdt.decimals).toBe(6);
  });

  it("adds Arbitrum One (chainId 42161) with the canonical implementation set, and USDC+USDT", () => {
    const arb = getChainProfile(42161);
    expect(arb).toBeDefined();
    expect(arb!.kind).toBe("evm");
    expect(arb!.chainId).toBe(42161);
    expect(arb!.canonicalImplementation).toBe("0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e");
    const tokens = Object.values(arb!.tokens);
    const usdc = tokens.find((t) => t.symbol === "USDC")!;
    expect(usdc.address).toBe("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
    expect(usdc.decimals).toBe(6);
    const usdt = tokens.find((t) => t.symbol === "USDT")!;
    expect(usdt.address).toBe("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9");
    expect(usdt.decimals).toBe(6);
  });

  it("adds BSC (chainId 56) with the canonical implementation set, and 18-decimal USDC+USDT", () => {
    const bsc = getChainProfile(56);
    expect(bsc).toBeDefined();
    expect(bsc!.kind).toBe("evm");
    expect(bsc!.chainId).toBe(56);
    expect(bsc!.canonicalImplementation).toBe("0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e");
    const tokens = Object.values(bsc!.tokens);
    const usdc = tokens.find((t) => t.symbol === "USDC")!;
    expect(usdc.address).toBe("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
    expect(usdc.decimals).toBe(18);
    const usdt = tokens.find((t) => t.symbol === "USDT")!;
    expect(usdt.address).toBe("0x55d398326f99059fF775485246999027B3197955");
    expect(usdt.decimals).toBe(18);
  });

  it("listFeeTokens filters to a single chain when a chainId is passed, and stays byte-identical no-arg", () => {
    const bscTokens = listFeeTokens("eip155:56");
    expect(bscTokens.length).toBe(2);
    expect(bscTokens.every((t) => t.chainId === "eip155:56")).toBe(true);
    const symbols = bscTokens.map((t) => (t.token as { symbol: string }).symbol).sort();
    expect(symbols).toEqual(["USDC", "USDT"]);

    const all = listFeeTokens();
    expect(all.some((t) => t.chainId === "eip155:1")).toBe(true);
    expect(all.some((t) => t.chainId === "eip155:42161")).toBe(true);
  });

  it("OP now includes a USDT fee token alongside the existing USDC", () => {
    const op = getChainProfile(10)!;
    const tokens = Object.values(op.tokens);
    const usdc = tokens.find((t) => t.symbol === "USDC")!;
    expect(usdc.address).toBe("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"); // unchanged
    const usdt = tokens.find((t) => t.symbol === "USDT")!;
    expect(usdt.address).toBe("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58");
    expect(usdt.decimals).toBe(6);
  });

  it("Base now includes a USDT fee token alongside the existing USDC", () => {
    const base = getChainProfile(8453)!;
    const tokens = Object.values(base.tokens);
    const usdc = tokens.find((t) => t.symbol === "USDC")!;
    expect(usdc.address).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"); // unchanged
    const usdt = tokens.find((t) => t.symbol === "USDT")!;
    expect(usdt.address).toBe("0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2");
    expect(usdt.decimals).toBe(6);
  });
});

describe("multi-chain expansion (Task 3): Arc testnet (USDC-only; native gas = USDC)", () => {
  it("adds Arc testnet (chainId 5042002) as a testnet profile with the canonical implementation set", () => {
    const arc = getChainProfileById("eip155:5042002");
    expect(arc).toBeDefined();
    expect(arc!.kind).toBe("evm");
    if (!arc || arc.kind !== "evm") return;
    expect(arc.chainId).toBe(5042002);
    expect(arc.isTestnet).toBe(true);
    expect(arc.canonicalImplementation).toBe("0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e");
    expect(arc.explorer).toBe("https://testnet.arcscan.app");
  });

  it("Arc has exactly one fee token (USDC, 6 decimals) and no USDT/wrapped-native", () => {
    const arc = getChainProfileById("eip155:5042002");
    expect(arc).toBeDefined();
    if (!arc || arc.kind !== "evm") return;
    const tokens = Object.values(arc.tokens);
    expect(tokens.length).toBe(1);
    const usdc = tokens.find((t) => t.symbol === "USDC")!;
    expect(usdc).toBeDefined();
    expect(usdc.address).toBe("0x3600000000000000000000000000000000000000");
    expect(usdc.decimals).toBe(6);
    expect(tokens.some((t) => t.symbol === "USDT")).toBe(false);
  });

  it("existing chains omit isTestnet (additive-only field)", () => {
    const op = getChainProfile(10)!;
    expect(op.isTestnet).toBeUndefined();
  });
});

describe("Robinhood Chain (chainId 4663): USDG-only; USDC/USDT tokens do not exist", () => {
  it("adds Robinhood Chain with the canonical implementation address", () => {
    const rhc = getChainProfile(4663);
    expect(rhc).toBeDefined();
    expect(rhc!.kind).toBe("evm");
    expect(rhc!.chainId).toBe(4663);
    expect(rhc!.id).toBe("eip155:4663");
    // The implementation is deterministic (CREATE2, fixed salt), so it has the SAME address on every
    // EVM chain and the registry lists it uniformly. Listing it is NOT a claim that it is deployed
    // here — `deploy-canonical` writes this address to every EVM slot after a deploy to any one chain.
    //
    // ⚠️ FOUNDER-ACCEPTED RISK (2026-07-12): as of now the implementation is deployed ONLY on Arc
    // (5042002). On every other chain this address has NO CODE. `canonicalImplementation` is the
    // EIP-7702 delegation target, so a wallet on an undeployed chain delegates to a codeless address
    // and its calls revert — a late, per-transaction failure, whereas the old zero-address sentinel
    // failed loud at config time. Deployment is tracked per chain OUT of band; the registry no longer
    // encodes it. Deploy before using any chain other than Arc.
    expect(rhc!.canonicalImplementation).toBe("0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e");
    expect(rhc!.explorer).toBe("https://robinhoodchain.blockscout.com");
    expect(rhc!.defaultRpc).toEqual([
      "https://rpc.mainnet.chain.robinhood.com",
      "https://gateway.tenderly.co/public/robinhood-chain",
    ]);
    expect(rhc!.capabilities).toEqual({ simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true });
  });

  it("has exactly one fee token: USDG (6 decimals)", () => {
    const rhc = getChainProfile(4663)!;
    const tokens = Object.values(rhc.tokens);
    expect(tokens.length).toBe(1);
    const usdg = tokens.find((t) => t.symbol === "USDG")!;
    expect(usdg).toBeDefined();
    expect(usdg.address).toBe("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
    expect(usdg.decimals).toBe(6);
  });

  it("does NOT contain USDC or USDT — regression guard against adding tokens just because feeds exist", () => {
    const rhc = getChainProfile(4663)!;
    const symbols = Object.values(rhc.tokens).map((t) => t.symbol);
    expect(symbols).not.toContain("USDC");
    expect(symbols).not.toContain("USDT");
  });
});

describe("Task 4b: operator-config-driven anchor chain", () => {
  it("resolves an explicit EVM anchor chain id to its profile", () => {
    const anchor = resolveAnchorChain("eip155:10");
    expect(anchor.kind).toBe("evm");
    expect(anchor.chainId).toBe(10);
  });

  it("resolves the DEFAULT_ANCHOR_CHAIN_ID to Optimism, without the resolver hardcoding any id", () => {
    expect(DEFAULT_ANCHOR_CHAIN_ID).toBe("eip155:10");
    const anchor = resolveAnchorChain(DEFAULT_ANCHOR_CHAIN_ID);
    expect(anchor.chainId).toBe(10);
  });

  it("throws when the configured anchor id is not present in the registry", () => {
    expect(() => resolveAnchorChain("eip155:999999")).toThrow();
  });
});

describe("chain-name → id resolver (additive alias layer)", () => {
  it("resolves each name to the correct CAIP-2 id (spot-check)", () => {
    expect(resolveChainByName("base")).toBe("eip155:8453");
    expect(resolveChainByName("arc-testnet")).toBe("eip155:5042002");
    expect(resolveChainByName("robinhood")).toBe("eip155:4663");
  });

  it("is case-insensitive", () => {
    expect(resolveChainByName("BASE")).toBe(resolveChainByName("base"));
    expect(resolveChainByName("Arc-Testnet")).toBe("eip155:5042002");
  });

  it("throws fail-loud on an unknown name, and the message names the valid options", () => {
    expect(() => resolveChainByName("mainnet")).toThrow(/unknown chain name/i);
    // Non-vacuous: the thrown message must actually list a real, valid name.
    try {
      resolveChainByName("mainnet");
      throw new Error("expected resolveChainByName to throw");
    } catch (e) {
      expect((e as Error).message).toContain("base");
    }
  });

  it("every alias points to a ChainId present in CHAIN_PROFILES (anti-dangling guard)", () => {
    for (const [name, id] of Object.entries(CHAIN_NAME_TO_ID)) {
      expect(CHAIN_PROFILES[id], `alias "${name}" → ${id} must exist in CHAIN_PROFILES`).toBeDefined();
    }
  });

  it("covers every chain in the registry", () => {
    const aliasedIds = new Set(Object.values(CHAIN_NAME_TO_ID));
    for (const id of Object.keys(CHAIN_PROFILES)) {
      expect(aliasedIds.has(id), `${id} must have a friendly-name alias`).toBe(true);
    }
  });

  it("chainIdNumberByName returns the numeric chainId, and throws on an unknown name", () => {
    expect(chainIdNumberByName("base")).toBe(8453);
    expect(chainIdNumberByName("arc-testnet")).toBe(5042002);
    expect(() => chainIdNumberByName("nope")).toThrow(/unknown chain name/i);
  });
});

describe("EVM-only registry", () => {
  // GUARD. v1 is EVM-only. The registry is where a cluster would reappear first: a chain profile is
  // the cheapest thing to add back, and everything downstream keys off it.
  it("lists no Solana cluster", () => {
    const source = readFileSync(new URL("./registry.ts", import.meta.url).pathname, "utf8");
    expect(source).not.toMatch(/solana|mainnet-beta|devnet/i);
  });
});
