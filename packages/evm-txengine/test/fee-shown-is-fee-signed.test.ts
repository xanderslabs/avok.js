import { describe, it, expect } from "vitest";
import { decodeFunctionData, erc20Abi, type Address } from "viem";
import { simulateResolved } from "../src/simulate.js";
import type { ResolvedBatch } from "../src/types.js";

/**
 * THE FEE SHOWN MUST BE THE FEE SIGNED.
 *
 * `simulateResolved` used to RE-PRICE the fee for display, from the SIMULATION's gas number — while
 * `feeCalls` (what the signature actually covers, and what the relayer moves) had been priced earlier
 * from `fullGasEstimate`, which also covers the EIP-7702 authorization intrinsic and the fee transfer
 * itself. Two gas numbers, two fees, inside ONE SimulationResult.
 *
 * On real hardware that shipped: the app displayed a 0.001921 USDC network fee and the chain moved
 * 0.004104 — the user consented to one number and signed another. Verified on chain, tx
 * 0xf3f16510…b246: wallet → fronter, 4104 base units, against a 1921 quote.
 *
 * The fee is now priced ONCE, at resolve, carried on the batch, and merely SURFACED here. This test
 * decodes the actual feeCall calldata and asserts the displayed amount equals it.
 */
const FEE_TOKEN = "0x3600000000000000000000000000000000000000" as Address;
const FRONTER = "0x25eD210D5b4D23e3d3d6cA7FEAB40ebF77Bc6A16" as Address;
const WALLET = "0xC459d1c3D00Bc07F06331c0335647DF3D28DEC06" as Address;
const SIGNED_FEE = 4104n; // what the batch committed to — the number the user signs

const batch: ResolvedBatch = {
  rail: "sponsored",
  chainId: 5042002,
  walletAddress: WALLET,
  feeCalls: [
    {
      to: FEE_TOKEN,
      value: 0n,
      // transfer(fronter, 4104)
      data: `0xa9059cbb${FRONTER.slice(2).padStart(64, "0")}${SIGNED_FEE.toString(16).padStart(64, "0")}` as `0x${string}`,
    },
  ],
  userCalls: [],
  nonce: 1n,
  deadline: 99999999999n,
  disclosures: [{ kind: "fee", feeToken: FEE_TOKEN, amount: SIGNED_FEE }],
  // Priced ONCE at resolve. This is the fee, and the only one anyone may show.
  fee: { feeToken: FEE_TOKEN, amount: SIGNED_FEE, gasUnits: 111_535n, gasPrice: 41_230_779_904n },
};

describe("the fee a user sees is the fee a user signs", () => {
  it("simulate reports the amount committed to feeCalls — it does not re-price", async () => {
    const sim = await simulateResolved(
      batch,
      {
        // A simulation whose gas is DELIBERATELY different from the resolve-time estimate. The old
        // code would have re-priced from this and shown a different number.
        rpc: { simulateCalls: async () => ({ success: true, gasUsed: 52_000n }) } as never,
        chain: { chainId: 5042002, canonicalImplementation: WALLET, capabilities: {} } as never,
      } as never,
      { gas: false },
    );

    // Decode the fee the user's signature actually covers.
    const decoded = decodeFunctionData({ abi: erc20Abi, data: batch.feeCalls[0]!.data });
    const signedAmount = decoded.args![1] as bigint;

    expect(signedAmount).toBe(SIGNED_FEE);
    expect(sim.fee?.amount).toBe(signedAmount); // ← displayed === signed
    expect(sim.fee?.amount).not.toBe(1921n); // ← the old, re-priced number
  });
});
