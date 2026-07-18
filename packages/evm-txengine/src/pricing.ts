import { type Address } from "viem";
import { selfPayEffectiveGasPrice, selfPayGasEstimate } from "./gas-model.js";
import type { RpcClient } from "./rpc.js";
import type { Call, NativeFeeEstimate } from "./types.js";

/**
 * Estimate what a SELF-PAY transaction will cost the wallet in native gas.
 *
 * No oracle and no fee token: self-pay is paid in the chain's own gas asset, so there is no currency
 * to convert into and no fronter to reimburse. Just gas × price. (The old sponsored `priceFee`/
 * `buildFeeCall` — the bespoke relay's fee model — retired with the 4337 rewrite; the paymaster now
 * prices the sponsored fee.)
 */
export async function estimateNativeFee(args: {
  rpc: RpcClient;
  walletAddress: Address;
  implementation: Address;
  calls: Call[];
  undelegated: boolean;
}): Promise<NativeFeeEstimate> {
  const gasUnits = await selfPayGasEstimate(args);
  const [baseFee, suggestedTip] = await Promise.all([
    args.rpc.getBaseFeePerGas(),
    args.rpc.getMaxPriorityFeePerGas(),
  ]);
  const gasPrice = selfPayEffectiveGasPrice(suggestedTip, baseFee);
  return { amount: gasUnits * gasPrice, gasUnits, gasPrice };
}
