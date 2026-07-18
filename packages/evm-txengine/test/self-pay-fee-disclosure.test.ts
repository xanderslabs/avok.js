import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import { estimateNativeFee } from "../src/pricing.js";
import { simulateResolved } from "../src/simulate.js";
import { AUTH_7702_GAS, BASE_TX_GAS, SELF_PAY_TIP_MUL, selfPayFees } from "../src/gas-model.js";
import type { ResolvedBatch } from "../src/types.js";

/**
 * SELF-PAY MUST STILL DISCLOSE A FEE.
 *
 * The sponsored rail commits a fee to `feeCalls`, so the amount is exact and signed. Self-pay commits
 * nothing — the chain debits the wallet's native balance at inclusion — and the consent screen used to
 * respond to that by showing the user no number at all ("paid in USDC at the current gas price").
 * "You will be charged something" is not a fee disclosure.
 *
 * These tests pin the two ways the estimate can go quietly wrong.
 */

const WALLET = "0xC459d1c3D00Bc07F06331c0335647DF3D28DEC06" as Address;
const IMPL = "0x3333333333333333333333333333333333333333" as Address;
const TOKEN = "0x3600000000000000000000000000000000000000" as Address;

// eth_simulateV1 reports the FULL transaction gas of the call it simulates — intrinsic, calldata and
// execution. Verified on Arc: simulating execute([transfer]) returns 56,090 and the real self-pay
// transaction used exactly 56,090. The estimator used to add the intrinsic and an envelope constant
// ON TOP of this, over-quoting the user by 51%.
const SIM_GAS = 56_090n;
// Three distinct numbers, satisfying the chain's identity gasPrice == baseFee + suggestedTip. The
// self-pay rail bids the SUGGESTED tip; it used to bid the whole gasPrice, paying the base fee twice.
const GAS_PRICE = 1_000_000_000n;     // eth_gasPrice = base + a SUGGESTED tip. Neither term on its own.
const BASE_FEE = 400_000_000n;        // the chain's actual base fee
const SUGGESTED_TIP = 600_000_000n;   // eth_maxPriorityFeePerGas — what to bid

const rpc = {
  simulateCalls: async () => [{ success: true, gasUsed: SIM_GAS }],
  // An undelegated wallet has no code, so the batch is simulated with the implementation injected.
  getCode: async () => "0x6080604052",
  getGasPrice: async () => GAS_PRICE,
  getBaseFeePerGas: async () => BASE_FEE,
  getMaxPriorityFeePerGas: async () => SUGGESTED_TIP,
} as never;

const transferCall = {
  to: TOKEN,
  value: 0n,
  data: `0xa9059cbb${"11".repeat(32)}${"22".repeat(32)}` as `0x${string}`,
};

describe("self-pay native fee estimate", () => {
  it("IS the simulation — self-pay sends exactly the transaction it simulates", async () => {
    const est = await estimateNativeFee({
      rpc, walletAddress: WALLET, implementation: IMPL, calls: [transferCall], undelegated: false,
    });

    // No constants, no double-count. The simulation already carries the intrinsic, the calldata and
    // the execute envelope, and self-pay broadcasts precisely that transaction.
    expect(est.gasUnits).toBe(SIM_GAS);
    expect(est.gasUnits).toBeLessThan(SIM_GAS + BASE_TX_GAS); // the old model added it again
    expect(est.amount).toBe(est.gasUnits * est.gasPrice);
  });

  it("charges the EIP-7702 authorization on the first (undelegated) send, and not after", async () => {
    const first = await estimateNativeFee({ rpc, walletAddress: WALLET, implementation: IMPL, calls: [transferCall], undelegated: true });
    const later = await estimateNativeFee({ rpc, walletAddress: WALLET, implementation: IMPL, calls: [transferCall], undelegated: false });

    // The account upgrade is a real, one-time cost the user pays. Hiding it makes the first send —
    // the one where trust is established — the one whose quote is wrong.
    expect(first.gasUnits - later.gasUnits).toBe(AUTH_7702_GAS);
  });

  it("prices at baseFee + the SUGGESTED tip — the price eth_gasPrice already predicted", async () => {
    const est = await estimateNativeFee({ rpc, walletAddress: WALLET, implementation: IMPL, calls: [transferCall], undelegated: false });

    // The price is STATED, not recomputed from the model under test. EIP-1559 charges baseFee + the
    // tip bid; bidding the tip the chain suggested costs 0.4 + 0.6 = 1.0 gwei — exactly what
    // eth_gasPrice said the transaction would cost. Reproducing eth_gasPrice is the point of it, and
    // it is the invariant a correct bid restores.
    const CORRECT_PRICE = 1_000_000_000n;
    expect(est.gasPrice).toBe(CORRECT_PRICE);

    // The two prices that shipped, both of them here, both certified by a test that re-derived them:
    expect(est.gasPrice).not.toBe(GAS_PRICE * 2n);            // "baseFee == gasPrice", so double it
    expect(est.gasPrice).not.toBe(BASE_FEE + GAS_PRICE);      // "gasPrice is a tip" — pays base twice
  });

  it("does NOT quote the maxFeePerGas ceiling, which would over-state the fee", async () => {
    const est = await estimateNativeFee({ rpc, walletAddress: WALLET, implementation: IMPL, calls: [transferCall], undelegated: false });
    // `selfPayFees().maxFeePerGas` carries spike headroom on the BASE fee; the chain refunds the
    // difference. Displaying the ceiling as the fee is a lie in the user's disfavour.
    const ceiling = selfPayFees(SUGGESTED_TIP, BASE_FEE).maxFeePerGas;
    expect(est.gasPrice).toBeLessThan(ceiling);
  });

  it("bids the tip the chain suggested — never the whole of eth_gasPrice", async () => {
    // The bid itself, not the quote. A tip is PAID, not refunded (unlike maxFee headroom), so bidding
    // eth_gasPrice — which already contains the base fee — pays the base fee a second time. On Arc
    // that was 42.4 gwei for a transaction that costs 22.4: +89%, charged to the user, on every send.
    const { maxPriorityFeePerGas, maxFeePerGas } = selfPayFees(SUGGESTED_TIP, BASE_FEE);

    expect(maxPriorityFeePerGas).toBe(SUGGESTED_TIP * SELF_PAY_TIP_MUL);
    expect(maxPriorityFeePerGas).not.toBe(GAS_PRICE); // the shipped overbid
    // Headroom belongs on the ceiling, where it is refunded — so maxFee still clears a base-fee spike.
    expect(maxFeePerGas).toBeGreaterThan(BASE_FEE + maxPriorityFeePerGas);
  });
});

describe("simulateResolved surfaces the estimate it was given", () => {
  const selfPayBatch: ResolvedBatch = {
    rail: "self-pay",
    chainId: 5042002,
    walletAddress: WALLET,
    feeCalls: [],
    userCalls: [transferCall],
    nonce: 1n,
    deadline: 99999999999n,
    disclosures: [],
    nativeFee: { amount: 123_456n, gasUnits: 80_000n, gasPrice: 2_000_000_000n },
  };

  it("passes batch.nativeFee through verbatim — it does not recompute from gasUsed", async () => {
    const sim = await simulateResolved(
      selfPayBatch,
      {
        rpc: { simulateCalls: async () => ({ success: true, gasUsed: SIM_GAS }) } as never,
        chain: { chainId: 5042002, canonicalImplementation: WALLET, capabilities: {} } as never,
        oracle: {} as never,
      } as never,
      { gas: false },
    );

    expect(sim.nativeFee).toEqual(selfPayBatch.nativeFee);
    expect(sim.fee).toBeUndefined(); // self-pay commits no fee — there is nothing signed to show
  });
});
