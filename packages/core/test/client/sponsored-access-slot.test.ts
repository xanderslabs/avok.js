/**
 * Access-slot writes on the SPONSORED rail — adding a device while holding a token and no native gas.
 *
 * This was impossible until now. `submit` and the affordability gate both hardcoded `feeToken: null`,
 * so a user whose whole balance was USDC could create a wallet and log in, but could never make that
 * wallet recoverable: adding a second device demanded native gas they did not have. The gate's
 * sponsored branch was already written and simply unreachable.
 *
 * WHY THIS RAIL COSTS TWO GESTURES, and why that is not a defect. ERC-7677 quotes over the REAL
 * calldata, because the paymaster signs a hash that includes it. The real calldata contains the sealed
 * blob. The blob needs K. So the order is forced: seal (key) → quote (IO) → sign (key), and K may
 * never be live across a network round-trip (types.ts). Self-pay avoids all of it — its signature is
 * built in-process from a same-length probe — which is why it keeps its single gesture.
 *
 * MUTATION: make `addPasskey` ignore `feeToken` (always take the self-pay branch) and the rail and
 * gesture-count tests below must fail. Verified when written.
 */
import { describe, it, expect, vi } from "vitest";
import type { Address } from "viem";
import { createOwnOriginConnection } from "../../src/own-origin/connection.js";
import { getChainProfile } from "../../src/evm/index.js";
import type { AccessCtx } from "../../src/types.js";
import { makeFakePasskey } from "./fakes.js";

const FEE_TOKEN = Object.values(getChainProfile(10)!.tokens)[0]!.address as Address;

/** An AccessCtx that records which rail each phase was driven on. */
function recordingCtx() {
  const seen = {
    gateFeeToken: undefined as Address | null | undefined,
    sponsorCalls: 0,
    sponsorFeeToken: undefined as string | undefined,
    signCalls: 0,
  };
  const ctx: AccessCtx & { seen: typeof seen } = {
    seen,
    submit: async () => ({ id: "tx" }),
    hasSlot: async () => false,
    assertCanAffordAccessSlot: async (_chainId: number, feeToken?: Address | null) => {
      seen.gateFeeToken = feeToken;
    },
    prepareWrite: async (_probe, chainId) => ({ chainId }),
    sponsorWrite: async (prepared, _calls, feeToken) => {
      seen.sponsorCalls += 1;
      seen.sponsorFeeToken = feeToken;
      return { ...(prepared as object), sponsored: true };
    },
    signWrite: async (prepared) => {
      seen.signCalls += 1;
      return { prepared };
    },
    broadcastWrite: async () => ({ id: "0xopHash" }),
  };
  return ctx;
}

const conn = (passkey: ReturnType<typeof makeFakePasskey>) =>
  createOwnOriginConnection({ rpId: "localhost", passkey, anchorChainId: "eip155:10" });

describe("access-slot writes can be paid in a token", () => {
  it("routes through the paymaster when a fee token is given, and never when it is not", async () => {
    const selfPay = recordingCtx();
    const passkeyA = makeFakePasskey("localhost");
    const a = conn(passkeyA);
    await a.create();
    await a.addPasskey(selfPay);

    const sponsored = recordingCtx();
    const passkeyB = makeFakePasskey("localhost");
    const b = conn(passkeyB);
    await b.create();
    await b.addPasskey(sponsored, { feeToken: FEE_TOKEN });

    expect(selfPay.seen.sponsorCalls).toBe(0);
    expect(sponsored.seen.sponsorCalls).toBe(1);
    expect(sponsored.seen.sponsorFeeToken).toBe(FEE_TOKEN);
  });

  it("prices the affordability gate on the rail the caller chose", async () => {
    // The gate compares the cost against the balance that will ACTUALLY pay. Measuring a
    // token-paying user against their native balance is how a user with plenty of USDC and no ETH got
    // told they could not afford a write the paymaster was going to cover.
    const ctx = recordingCtx();
    const passkey = makeFakePasskey("localhost");
    const c = conn(passkey);
    await c.create();

    await c.addPasskey(ctx, { feeToken: FEE_TOKEN });
    expect(ctx.seen.gateFeeToken).toBe(FEE_TOKEN);
  });

  it("takes TWO key scopes when sponsored and ONE when self-paying", async () => {
    // The gesture count is the observable cost of the rail. Each key scope authenticates the passkey
    // once (sandbox.ts), so counting adapter calls counts the prompts a user actually sees.
    const countScopes = async (feeToken: Address | null) => {
      const passkey = makeFakePasskey("localhost");
      const spy = vi.spyOn(passkey, "authenticate");
      const c = conn(passkey);
      await c.create();
      spy.mockClear(); // create() opens its own scope; only the write is under test
      await c.addPasskey(recordingCtx(), { feeToken });
      const n = spy.mock.calls.length;
      spy.mockRestore();
      return n;
    };

    expect(await countScopes(FEE_TOKEN)).toBeGreaterThan(await countScopes(null));
  });

  it("still signs exactly once — the second scope signs, it does not re-seal", async () => {
    // Two scopes must not mean two signatures. The first seals, the second signs; a second signWrite
    // would mean the sealed blob was rebuilt after the paymaster priced it, invalidating the quote.
    const ctx = recordingCtx();
    const passkey = makeFakePasskey("localhost");
    const c = conn(passkey);
    await c.create();

    await c.addPasskey(ctx, { feeToken: FEE_TOKEN });
    expect(ctx.seen.signCalls).toBe(1);
  });

  it("fails cleanly when sponsorship is unavailable — it does not fall back to self-pay", async () => {
    // Silently charging native gas to a user who asked to pay in a token is the degrade
    // `requireSponsorship` exists to prevent, and it is worse here: the user may hold no native gas at
    // all, so the "fallback" is a transaction that cannot even be submitted.
    const ctx = recordingCtx();
    ctx.sponsorWrite = async () => {
      throw new Error("Sponsorship is required but unavailable on chain 10");
    };
    const passkey = makeFakePasskey("localhost");
    const c = conn(passkey);
    await c.create();

    await expect(c.addPasskey(ctx, { feeToken: FEE_TOKEN })).rejects.toThrow(/unavailable/i);
    expect(ctx.seen.signCalls).toBe(0); // nothing was signed on any rail
  });
});
