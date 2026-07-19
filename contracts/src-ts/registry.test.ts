import { describe, expect, it } from "vitest";
import {
  getChainProfile,
  getTokenProfile,
  getSolanaChainProfile,
  getSolanaTokenProfile,
  getChainProfileById,
  listChains,
  listFeeTokens,
  resolveAnchorChain,
  DEFAULT_ANCHOR_CHAIN_ID,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  getEnsDeployment,
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

describe("unified registry — Solana + cohesion", () => {
  it("keeps the EVM profile byte-identical and tags it kind/id", () => {
    const op = getChainProfile(10)!;
    expect(op.kind).toBe("evm");
    expect(op.id).toBe("eip155:10");
    expect(op.chainId).toBe(10);
  });

  it("exposes Solana mainnet with USDC", () => {
    const sol = getSolanaChainProfile("mainnet")!;
    expect(sol.kind).toBe("solana");
    expect(sol.id).toBe("solana:mainnet");
    const usdc = getSolanaTokenProfile("mainnet", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")!;
    expect(usdc.symbol).toBe("USDC");
    expect(usdc.decimals).toBe(6);
  });

  it("every Solana token names a known program AND a measured ATA size", () => {
    // Sanity-check the exported constants
    expect(TOKEN_PROGRAM).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    expect(TOKEN_2022_PROGRAM).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

    for (const cluster of ["mainnet", "devnet"] as const) {
      const profile = getSolanaChainProfile(cluster)!;
      for (const token of Object.values(profile.tokens)) {
        expect([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]).toContain(token.tokenProgram);

        // `ataSize` is what the create-ATA rent is looked up with, and on the self-pay rail the USER
        // pays that rent (~0.002 SOL — some 400x the base fee). A token added without a MEASURED size
        // would quietly put a wrong number on a consent screen, so it is required, not optional.
        expect(token.ataSize).toBeGreaterThan(0);

        // A classic SPL token account is exactly 165 bytes (getTokenSize()). A Token-2022 account is
        // NOT: its length depends on the mint's extensions, so it must be measured per mint and is
        // deliberately not asserted to any constant here.
        if (token.tokenProgram === TOKEN_PROGRAM) expect(token.ataSize).toBe(165);
      }
    }
  });

  it("resolves either namespace by id and narrows on kind", () => {
    expect(getChainProfileById("eip155:8453")!.kind).toBe("evm");
    expect(getChainProfileById("solana:mainnet")!.kind).toBe("solana");
    expect(getChainProfileById("eip155:99999")).toBeUndefined();
  });

  it("lists chains and fee tokens across both chains (the umbrella surface)", () => {
    const kinds = new Set(listChains().map((c) => c.kind));
    expect(kinds.has("evm")).toBe(true);
    expect(kinds.has("solana")).toBe(true);
    const tokens = listFeeTokens();
    expect(tokens.some((t) => t.chainId === "eip155:10")).toBe(true);
    expect(tokens.some((t) => t.chainId === "solana:mainnet")).toBe(true);
  });
});

describe("Task 4: Solana USDT token", () => {
  it("solana:mainnet has a USDT fee token alongside USDC", () => {
    const usdt = getSolanaTokenProfile("mainnet", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")!;
    expect(usdt).toBeDefined();
    expect(usdt.symbol).toBe("USDT");
    expect(usdt.decimals).toBe(6);
    expect(usdt.tokenProgram).toBe(TOKEN_PROGRAM);
  });

  it("solana:devnet has no USDT token, plus a Token-2022 PYUSD", () => {
    const sol = getSolanaChainProfile("devnet")!;

    // PYUSD (Token-2022) — devnet only. Its ATA is 187 bytes, MEASURED by simulating a create-ATA for
    // a fresh owner; the obvious derivation from the TLV layout gives 182 and is wrong, which is the
    // whole reason this is pinned rather than computed.
    const pyusd = getSolanaTokenProfile("devnet", "CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM")!;
    expect(pyusd.symbol).toBe("PYUSD");
    expect(pyusd.decimals).toBe(6);
    expect(pyusd.tokenProgram).toBe(TOKEN_2022_PROGRAM);
    expect(pyusd.ataSize).toBe(187);
    expect(pyusd.ataSize).not.toBe(165); // the classic size would under-state its rent by ~153k lamports

    expect(Object.keys(sol.tokens)).toHaveLength(2);
    expect(Object.values(sol.tokens).some((t) => t.symbol === "USDT")).toBe(false);
  });
});

describe("multi-chain expansion (Task 2): Ethereum, Arbitrum, BSC + USDT", () => {
  it("adds Ethereum (chainId 1) with the canonical implementation set, and USDC+USDT", () => {
    const eth = getChainProfile(1);
    expect(eth).toBeDefined();
    expect(eth!.kind).toBe("evm");
    expect(eth!.chainId).toBe(1);
    expect(eth!.canonicalImplementation).toBe("0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C");
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
    expect(arb!.canonicalImplementation).toBe("0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C");
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
    expect(bsc!.canonicalImplementation).toBe("0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C");
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
    expect(arc.canonicalImplementation).toBe("0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C");
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
    expect(rhc!.canonicalImplementation).toBe("0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C");
    expect(rhc!.explorer).toBe("https://robinhoodchain.blockscout.com");
    expect(rhc!.rpcDefault).toBe("https://rpc.mainnet.chain.robinhood.com");
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

  it("throws when the configured anchor points at a Solana chain", () => {
    expect(() => resolveAnchorChain("solana:mainnet")).toThrow(/EVM/i);
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
    expect(resolveChainByName("solana-devnet")).toBe("solana:devnet");
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

  it("covers every EVM chain in the registry plus the Solana clusters", () => {
    const aliasedIds = new Set(Object.values(CHAIN_NAME_TO_ID));
    for (const id of Object.keys(CHAIN_PROFILES)) {
      expect(aliasedIds.has(id), `${id} must have a friendly-name alias`).toBe(true);
    }
  });

  it("chainIdNumberByName returns the numeric chainId for EVM chains and throws for Solana", () => {
    expect(chainIdNumberByName("base")).toBe(8453);
    expect(chainIdNumberByName("arc-testnet")).toBe(5042002);
    expect(() => chainIdNumberByName("solana-mainnet")).toThrow(/not an EVM chain/i);
    expect(() => chainIdNumberByName("nope")).toThrow(/unknown chain name/i);
  });
});

describe("ENS deployments", () => {
  it("returns mainnet ENS contracts for chainId 1", () => {
    const d = getEnsDeployment(1);
    expect(d.registry).toBe("0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e");
    expect(d.publicResolver).toBe("0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63");
  });
  it("throws fail-loud on a chain with no ENS deployment", () => {
    expect(() => getEnsDeployment(56)).toThrow(/no ENS deployment/i);
  });
});
