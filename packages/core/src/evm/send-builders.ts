import type { Hex } from "viem";
import { encodeExecuteBatch } from "./sim-methods.js";
import type { ResolvedBatch } from "./types.js";

/** self-pay: the wallet EOA's own type-4 tx calls execute(MODE_BATCH, executionData). */
export function buildSelfPayCalldata(batch: ResolvedBatch): Hex {
  return encodeExecuteBatch([...batch.feeCalls, ...batch.userCalls]);
}
