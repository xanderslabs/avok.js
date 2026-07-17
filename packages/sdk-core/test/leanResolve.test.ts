import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import { leanResolve } from "../src/client/resolve.js";
import { makeFakeRpc } from "./fakes.js";
import { getChainProfile } from "@avokjs/evm-txengine";

// chainId 10 (Optimism) exists in the registry. canonicalImplementation is the PENDING
// zero address (0x000...0), which triggers the fail-loud guard for undelegated wallets.
// Tests that exercise the undelegated path use a testChain with a non-zero implementation.
const baseChain = getChainProfile(10)!;
// chain.tokens is Record<string, EvmTokenProfile>; get the first token (OP USDC).
const feeToken = Object.values(baseChain.tokens)[0]!.address;

// Non-zero canonical implementation used in undelegated tests to avoid the guard.
const NON_ZERO_IMPL = "0x1234567890123456789012345678901234567890" as const satisfies Address;
const testChain = { ...baseChain, canonicalImplementation: NON_ZERO_IMPL };

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const USER_CALL = { to: "0x2222222222222222222222222222222222222222" as const, value: 0n, data: "0x" as const };


describe("leanResolve", () => {
  it("fronted (4337): undelegated wallet gets an authorization and NO fee call — the paymaster charges the fee", async () => {
    const rpc = makeFakeRpc({ delegated: false, nonce: 3n });
    const batch = await leanResolve({
      rpc,
      chain: testChain,
      address: WALLET,
      userCalls: [USER_CALL],
      ctx: { chainId: 10, feeToken },
      nonce: 0n,
      deadline: 9_999_999_999n,
    });

    expect(batch.rail).toBe("fronted");
    expect(batch.authorization?.address).toBe(testChain.canonicalImplementation);
    // No feeCall: the 4337 paymaster fronts the gas and charges the user; nothing is priced here.
    expect(batch.feeCalls).toHaveLength(0);
    // The paymaster context token is carried so a re-sent SimulationResult sponsors identically.
    expect(batch.feeToken?.toLowerCase()).toBe(feeToken.toLowerCase());
  });

  it("self-pay: feeCalls is empty and rail is self-pay", async () => {
    const rpc = makeFakeRpc({ delegated: false, nonce: 0n });
    const batch = await leanResolve({
      rpc,
      chain: testChain,
      address: WALLET,
      userCalls: [USER_CALL],
      ctx: { chainId: 10 }, // no feeToken → self-pay
      nonce: 0n,
      deadline: 9_999_999_999n,
    });

    expect(batch.rail).toBe("self-pay");
    expect(batch.feeCalls).toHaveLength(0);
    // delegation still applied (wallet is undelegated)
    expect(batch.authorization?.address).toBe(testChain.canonicalImplementation);
  });

  it("already-delegated fronted: no authorization emitted, still no fee call", async () => {
    // Return the EIP-7702 designator for the canonical implementation.
    const rpc = makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 0n });
    const batch = await leanResolve({
      rpc,
      chain: testChain,
      address: WALLET,
      userCalls: [USER_CALL],
      ctx: { chainId: 10, feeToken },
      nonce: 0n,
      deadline: 9_999_999_999n,
    });

    expect(batch.authorization).toBeUndefined();
    expect(batch.feeCalls).toHaveLength(0);
  });

  it("self-pay rail when feeToken absent", async () => {
    const rpc = makeFakeRpc({ delegated: false, nonce: 0n });
    await expect(
      leanResolve({
        rpc,
        chain: testChain,
        address: WALLET,
        userCalls: [USER_CALL],
        ctx: { chainId: 10 }, // no feeToken
        nonce: 0n,
        deadline: 9_999_999_999n,
      }),
    ).resolves.toMatchObject({ rail: "self-pay", feeCalls: [] });
  });

  it("disclosures: delegation present for undelegated fronted; NO fee disclosure (the paymaster charges it)", async () => {
    const rpc = makeFakeRpc({ delegated: false, nonce: 0n });
    const batch = await leanResolve({
      rpc,
      chain: testChain,
      address: WALLET,
      userCalls: [USER_CALL],
      ctx: { chainId: 10, feeToken },
      nonce: 0n,
      deadline: 9_999_999_999n,
    });

    const kinds = batch.disclosures.map((d) => d.kind);
    expect(kinds).toContain("delegation");
    expect(kinds).not.toContain("fee");
  });

  it("throws when canonicalImplementation is zero for an undelegated wallet", async () => {
    const rpc = makeFakeRpc({ delegated: false, nonce: 0n });
    const zeroChain = { ...baseChain, canonicalImplementation: "0x0000000000000000000000000000000000000000" as Address };
    await expect(
      leanResolve({
        rpc,
        chain: zeroChain,
        address: WALLET,
        userCalls: [USER_CALL],
        ctx: { chainId: 10 },
        nonce: 0n,
        deadline: 9_999_999_999n,
      }),
    ).rejects.toThrow("canonicalImplementation for chain 10 is unset (zero address)");
  });

  it("throws when canonicalImplementation has no code on-chain (undeployed)", async () => {
    // Non-zero canonicalImplementation (so the zero-address guard doesn't fire), but the fake
    // rpc reports no code at that address — simulating a chain where the registry names the
    // golden delegate address before it's actually been deployed there.
    const rpc = makeFakeRpc({ delegated: false, nonce: 0n, implDeployed: false });
    await expect(
      leanResolve({
        rpc,
        chain: testChain,
        address: WALLET,
        userCalls: [USER_CALL],
        ctx: { chainId: 10 },
        nonce: 0n,
        deadline: 9_999_999_999n,
      }),
    ).rejects.toThrow(/not deployed on chain/);
  });
});
