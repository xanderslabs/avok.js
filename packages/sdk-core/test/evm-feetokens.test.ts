import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import { getChainProfile } from "@avokjs/txengine";
import type { Connection } from "../src/types.js";
import { createEvmNamespace } from "../src/client/evm.js";
import { UnsupportedFeeTokenError } from "../src/client/fee-token-error.js";
import { makeFakeRpc } from "./fakes.js";
import type { PriceOracle } from "@avokjs/oracle";

const BASE = 8453;
const ARBITRUM = 42161;
// Base USDC — a real registry address, but NOT a fee token on Arbitrum (a different address is).
const BASE_USDC = Object.values(getChainProfile(BASE)!.tokens)[0]!.address;

/** Minimal Connection double — an active account, no real signing. */
function makeFakeConnection(): Connection {
  return {
    account: () => ({
      evm: { address: "0x1111111111111111111111111111111111111111" as Address },
      solana: { address: "11111111111111111111111111111111" },
    }),
    status: () => true,
  } as unknown as Connection;
}

const fakeOracle: PriceOracle = { read: async () => ({ priceE8: 200_000_000_000n }) };
const USER_CALL = { to: "0x2222222222222222222222222222222222222222" as Address, value: 0n, data: "0x" as const };

describe("evm.feeTokens", () => {
  it("returns the registry's fee tokens for a chain, and a DIFFERENT set for another chain", () => {
    const evm = createEvmNamespace({ connection: makeFakeConnection() });
    const base = evm.feeTokens(BASE);
    const arbitrum = evm.feeTokens(ARBITRUM);

    // Both chains carry USDC, but at chain-specific addresses — the whole point of the bug fix.
    expect(base.some((t) => t.symbol === "USDC")).toBe(true);
    expect(arbitrum.some((t) => t.symbol === "USDC")).toBe(true);
    const baseAddrs = base.map((t) => t.address.toLowerCase());
    const arbAddrs = arbitrum.map((t) => t.address.toLowerCase());
    // No address is shared across the two chains — a token from one is meaningless on the other.
    expect(baseAddrs.some((a) => arbAddrs.includes(a))).toBe(false);
    expect(base.every((t) => typeof t.address === "string" && typeof t.decimals === "number")).toBe(true);
  });

  it("evm.simulate throws 'chainId is required' when chainId is omitted (no silent default)", async () => {
    // Red-check: killing the per-call chainId requirement (reintroducing a default) makes this pass.
    const evm = createEvmNamespace({ connection: makeFakeConnection() });
    await expect(evm.simulate([USER_CALL])).rejects.toThrow(/chainId is required/i);
  });

  it("returns USDG (and only USDG) for Robinhood Chain 4663 — so fronted gating (paymaster + ≥1 fee token) can engage", () => {
    const evm = createEvmNamespace({ connection: makeFakeConnection() });
    const rhc = evm.feeTokens(4663);
    expect(rhc.length).toBe(1);
    expect(rhc[0].symbol).toBe("USDG");
    expect(rhc[0].decimals).toBe(6);
    // Length > 0 → the fronted fee-token side of the gate is satisfied for this chain.
    expect(rhc.length > 0).toBe(true);
    // Regression guard: the USDC/USDT feeds exist on-chain but the tokens do not.
    expect(rhc.some((t) => t.symbol === "USDC")).toBe(false);
    expect(rhc.some((t) => t.symbol === "USDT")).toBe(false);
  });
});

describe("resolveFeeToken chain validation", () => {
  it("throws UnsupportedFeeTokenError when the per-send feeToken is not a fee token on the TARGET chain", async () => {
    // The per-send feeToken is Base USDC, but the tx targets Arbitrum, where that address means
    // nothing. With a bundler + paymaster configured (canFront), the validation is the only thing
    // standing between the caller and a fronted send. Assert the concrete error TYPE.
    // Mutation guard: delete the `throw` in resolveFeeToken and this stops rejecting (it would proceed
    // into the fronted path), so the assertion goes red on the ABSENCE of the throw.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      paymasterUrl: "http://p",
      bundlerUrl: "http://b",
      deps: { rpc: makeFakeRpc({ delegated: false, nonce: 0n }), oracle: fakeOracle },
    });
    await expect(evm.simulate([USER_CALL], { chainId: ARBITRUM, feeToken: BASE_USDC })).rejects.toBeInstanceOf(
      UnsupportedFeeTokenError,
    );
  });

  it("a mismatched feeToken on a chain WITHOUT a bundler/paymaster falls back to self-pay (no throw)", async () => {
    // No 4337 infra → a fronted attempt self-pays instead of erroring (SPEC §1); the token is not even
    // validated because it is never forwarded.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      deps: {
        rpc: makeFakeRpc({ delegated: false, nonce: 0n }),
        oracle: fakeOracle,
        chain: { ...getChainProfile(ARBITRUM)!, canonicalImplementation: "0x1234567890123456789012345678901234567890" },
      },
    });
    const sim = await evm.simulate([USER_CALL], { chainId: ARBITRUM, feeToken: BASE_USDC });
    expect(sim.batch.rail).toBe("self-pay");
    expect(sim.fee).toBeUndefined();
  });

  it("explicit feeToken:null forces self-pay even with a bundler/paymaster configured", async () => {
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      paymasterUrl: "http://p",
      bundlerUrl: "http://b",
      deps: {
        rpc: makeFakeRpc({ delegated: false, nonce: 0n }),
        oracle: fakeOracle,
        chain: { ...getChainProfile(ARBITRUM)!, canonicalImplementation: "0x1234567890123456789012345678901234567890" },
      },
    });
    const sim = await evm.simulate([USER_CALL], { chainId: ARBITRUM, feeToken: null });
    expect(sim.batch.rail).toBe("self-pay");
    expect(sim.fee).toBeUndefined();
  });
});
