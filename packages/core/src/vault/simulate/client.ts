/**
 * `vault/simulate` — TDD §5 step 2: simulate a batch against the Vault's own pinned RPC and turn the
 * result into asset deltas and approval grants a consent screen can render as "you send / you
 * receive" rows, without trusting anything the requesting app asserts.
 *
 * Three outcomes, and the caller (the consent screen) is expected to render each differently:
 *   - "simulated": the batch ran; `deltas`/`approvals` describe what it actually did.
 *   - "reverted": the batch would fail on chain — `revert.reason` is shown, and this BLOCKS the happy
 *     path (TDD §5 step 3: a revert is not something to sign around).
 *   - "unsimulated": the RPC has no `eth_simulateV1` (Arc, today) or the call failed outright. Falls
 *     back to decode-only display — this module returns empty deltas/approvals; nothing here should
 *     be read as "nothing happens," only as "not verified."
 */
import { decodeAbiParameters, decodeErrorResult, getAddress, type Address, type Hex } from "viem";
import type { RpcClient, SimLog } from "../../evm/rpc.js";
import { decodeDeltasAndApprovals, nativeDeltasFromCalls, type AssetDelta, type ApprovalGrant } from "./deltas.js";

export type { SimLog };

export interface SignTxCall {
  to: Address;
  value: bigint;
  data: Hex;
}

/** The batch a `sign-tx` request carries — chain-agnostic on this module's side; the caller resolves
 *  `account` from whatever connection/session state it already holds. */
export interface SignTxPayload {
  chainId: number;
  /** The wallet whose deltas are being rendered — `directionFor` in deltas.ts reads relative to this. */
  account: Address;
  calls: SignTxCall[];
}

export type SimulationStatus = "simulated" | "unsimulated" | "reverted";

export interface SimulationResult {
  status: SimulationStatus;
  deltas: AssetDelta[];
  approvals: ApprovalGrant[];
  revert?: { reason: string };
}

const ERROR_STRING_SELECTOR = "0x08c379a0";

/** Best-effort human reason from a revert's return data. Standard `Error(string)` decodes cleanly;
 *  anything else (a custom error, a bare `revert()`, an out-of-gas) is shown as what it is rather than
 *  guessed at — a wrong guess is worse than an honest "the call reverted" with no further detail. */
function revertReason(returnData: Hex): string {
  if (returnData.startsWith(ERROR_STRING_SELECTOR)) {
    try {
      const [reason] = decodeAbiParameters([{ type: "string" }], `0x${returnData.slice(10)}`);
      return reason;
    } catch {
      // Fall through to the generic message below.
    }
  }
  if (returnData !== "0x") {
    try {
      const decoded = decodeErrorResult({ data: returnData });
      return `${decoded.errorName}(${decoded.args?.join(", ") ?? ""})`;
    } catch {
      // Not a standard error encoding this can name — say so plainly below.
    }
  }
  return returnData === "0x" ? "Reverted with no reason given" : `Reverted (undecoded return data: ${returnData})`;
}

/**
 * Simulate `req.calls` against `rpc` and classify the outcome. Never throws for an ordinary
 * simulation failure or an unsupported RPC — those are the "unsimulated" outcome, not an error the
 * caller must catch. A programming error (a malformed request) still throws.
 */
export async function simulateRequest(rpc: RpcClient, req: SignTxPayload): Promise<SimulationResult> {
  let results: Awaited<ReturnType<RpcClient["simulateCalls"]>>;
  try {
    results = await rpc.simulateCalls({
      account: req.account,
      calls: req.calls.map((c) => ({ to: c.to, value: c.value, data: c.data })),
    });
  } catch {
    // The RPC lacks eth_simulateV1 (Arc, today) or the call failed outright — either way, "not
    // verified," never "nothing happens." The consent screen falls back to decode-only display.
    return { status: "unsimulated", deltas: [], approvals: [] };
  }

  const failed = results.find((r) => r.status === "failure");
  if (failed) {
    return { status: "reverted", deltas: [], approvals: [], revert: { reason: revertReason(failed.returnData) } };
  }

  const account = getAddress(req.account);
  const logs: SimLog[] = results.flatMap((r) => r.logs ?? []);
  const { deltas: logDeltas, approvals } = decodeDeltasAndApprovals(logs, account);
  const deltas = [...nativeDeltasFromCalls(req.calls), ...logDeltas];

  return { status: "simulated", deltas, approvals };
}
