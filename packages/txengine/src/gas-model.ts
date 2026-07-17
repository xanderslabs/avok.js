import { type Address } from "viem";
import type { RpcClient } from "./rpc.js";
import { encodeExecuteBatch } from "./sim-methods.js";
import type { Call } from "./types.js";

/**
 * Protocol gas constants. Deliberately FEW: gas is now MEASURED by simulating the batch, so the only
 * constant left is the 7702 authorization a simulation cannot show, plus the base intrinsic. Fail-loud
 * guarded at load. (The fronted-envelope constant + calldata-cost helpers retired with the bespoke
 * relay — the 4337 rail measures gas through the bundler.)
 */

/** Base transaction intrinsic gas. */
export const BASE_TX_GAS: bigint = 21_000n;
/** EIP-7702 authorization cost (PER_EMPTY_ACCOUNT_COST = 25000, per the EIP-7702 spec), charged only on the first (undelegated) send. */
export const AUTH_7702_GAS: bigint = 25_000n;

// Fail-loud: none of these may be zero/negative — a zeroed constant would silently undercharge.
for (const [name, v] of Object.entries({
  BASE_TX_GAS, AUTH_7702_GAS,
})) {
  if (v <= 0n) throw new Error(`${name} must be a positive bigint, got ${v} (calibrate before mainnet, spec §15)`);
}

/**
 * Send-time EIP-1559 policy for the client self-pay path.
 *
 * `SELF_PAY_FEE_MUL` multiplies the BASE FEE to buy spike headroom on the maxFee CEILING — which
 * EIP-1559 refunds, so headroom there is free. `SELF_PAY_TIP_MUL` multiplies the tip the CHAIN
 * SUGGESTED. The tip is NOT refunded: every wei bid over the odds is a wei paid.
 *
 * Both multiply the right term now. The shipped version multiplied `eth_gasPrice` — base + a
 * suggested tip — and bid the whole thing as a tip, which pays the base fee twice. See RpcClient.
 */
export const SELF_PAY_FEE_MUL = 2n;
export const SELF_PAY_TIP_MUL = 1n;
export function selfPayFees(
  suggestedTip: bigint,
  baseFee: bigint,
): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  const maxPriorityFeePerGas = suggestedTip * SELF_PAY_TIP_MUL;
  return { maxFeePerGas: baseFee * SELF_PAY_FEE_MUL + maxPriorityFeePerGas, maxPriorityFeePerGas };
}

/**
 * The price per gas a self-pay transaction is EXPECTED TO PAY: the chain's BASE FEE plus the tip it
 * bids on top. `selfPayFees().maxFeePerGas` is a CEILING, not a price — EIP-1559 charges
 * `baseFee + tip` and refunds the rest.
 *
 * Two wrong answers have shipped here, and each looked right because the code that consumed it agreed:
 *
 *   `gasPrice × 2`          — assumes `eth_gasPrice` IS the base fee. It is not.
 *   `baseFee + gasPrice`    — assumes `eth_gasPrice` is a TIP. It is not that either: it is
 *                             base + a suggested tip, so this bids the base fee a second time.
 *
 * Measured on Arc block 51,806,713: base 20.0 gwei, gasPrice 22.435, suggested tip 2.435. The
 * transaction costs `20.0 + 2.435 = 22.435` gwei. The shipped formula said 42.435 — and both the
 * quote and the bid were wrong together, so nothing disagreed and the user paid +89%.
 */
export function selfPayEffectiveGasPrice(suggestedTip: bigint, baseFee: bigint): bigint {
  return baseFee + suggestedTip * SELF_PAY_TIP_MUL;
}

/**
 * Gas for the wallet executing `calls` as ONE batch — the way the chain runs them, so cold-access
 * costs are paid once. Returns the full transaction gas (intrinsic + calldata + execution).
 *
 * An undelegated wallet has no code yet, so `execute` would not exist: inject the implementation
 * bytecode at the wallet address for the simulation. This is exactly what the consent-screen
 * simulator already does (sim-methods.ts) — the gas estimator was the one place still guessing.
 */
async function simulateBatchGas(args: {
  rpc: RpcClient; walletAddress: Address; implementation: Address; calls: Call[]; undelegated: boolean;
}): Promise<bigint> {
  const { rpc, walletAddress, implementation, calls, undelegated } = args;
  if (calls.length === 0) return BASE_TX_GAS;

  const data = encodeExecuteBatch(calls);
  const results = await rpc.simulateCalls({
    account: walletAddress,
    calls: [{ from: walletAddress, to: walletAddress, data }],
    ...(undelegated ? { stateOverrides: [{ address: walletAddress, code: await rpc.getCode(implementation) }] } : {}),
  });
  return results.reduce((sum, r) => sum + r.gasUsed, 0n);
}

/**
 * Full-transaction gas for the SELF-PAY rail — and it is EXACT, not an approximation.
 *
 * Self-pay sends precisely the transaction this simulates: the wallet calling `execute` on itself. So
 * the simulation's gas IS the answer — intrinsic, calldata and execution, all of it. Verified against
 * the chain: simulating `execute([transfer])` returns 56,090 and the real transaction used 56,090.
 *
 * The old version summed per-call simulations and then added the 21k intrinsic (already inside each
 * simulation) and a 10k envelope constant (already inside it too), quoting ~85k for that same 56k
 * transaction — a 51% over-quote, which is exactly the gap that showed up on a real consent screen.
 */
export async function selfPayGasEstimate(args: {
  rpc: RpcClient; walletAddress: Address; implementation: Address; calls: Call[]; undelegated: boolean;
}): Promise<bigint> {
  const batchGas = await simulateBatchGas(args);
  // The 7702 authorization is the ONE cost the simulation cannot show: it is charged by the outer
  // transaction, not by the call being simulated.
  return batchGas + (args.undelegated ? AUTH_7702_GAS : 0n);
}
