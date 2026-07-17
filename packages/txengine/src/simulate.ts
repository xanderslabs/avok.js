import { type Hex, slice } from "viem";
import type { EvmChainProfile } from "@avokjs/contracts";
import type { PriceOracle } from "@avokjs/oracle";
import type { RpcClient } from "./rpc.js";
import {
  simulateV1Method,
  stateOverrideMethod,
  type SimOutcome,
} from "./sim-methods.js";
import type {
  Call,
  DecodedCall,
  ResolvedBatch,
  SimMethod,
  SimulationConfidence,
  SimulationResult,
} from "./types.js";

export interface SimulateDeps {
  rpc: RpcClient;
  oracle: PriceOracle;
  chain: EvmChainProfile;
}

/** Built-in selector → human label map for consent rendering. Covers the everyday-money surface:
 *  ERC-20 value movement + EIP-2612 permit, ERC-721/1155 transfers + approvals, and WETH wrap/unwrap.
 *  Callers can extend it per-call via decodeCalls' optional `extra` map (a pluggable decoder). */
const KNOWN_SELECTORS: Record<string, string> = {
  // ERC-20
  "0xa9059cbb": "transfer(address,uint256)",
  "0x095ea7b3": "approve(address,uint256)",
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0xd505accf": "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
  // ERC-721 / ERC-1155
  "0x42842e0e": "safeTransferFrom(address,address,uint256)",
  "0xb88d4fde": "safeTransferFrom(address,address,uint256,bytes)",
  "0xa22cb465": "setApprovalForAll(address,bool)",
  "0xf242432a": "safeTransferFrom(address,address,uint256,uint256,bytes)",
  // WETH wrap / unwrap
  "0xd0e30db0": "deposit()",
  "0x2e1a7d4d": "withdraw(uint256)",
};

/** Decode calls to consent-friendly rows. `extra` overlays/extends the built-in selector labels
 *  (e.g. an app that surfaces its own contract methods) without forking this module. */
export function decodeCalls(calls: Call[], extra?: Record<string, string>): DecodedCall[] {
  return calls.map((c) => {
    const selector = (c.data && c.data.length >= 10 ? slice(c.data as Hex, 0, 4) : "0x") as Hex;
    return { to: c.to, value: c.value, selector, label: extra?.[selector] ?? KNOWN_SELECTORS[selector] };
  });
}

const FALLBACK_GAS = 300_000n;

export async function simulateResolved(
  batch: ResolvedBatch,
  deps: SimulateDeps,
  opts: { gas?: boolean; authorizationPresent?: boolean } = {},
): Promise<SimulationResult> {
  const calls = [...batch.feeCalls, ...batch.userCalls];
  const methodArgs = {
    address: batch.walletAddress,
    implementation: deps.chain.canonicalImplementation,
    calls,
  };

  let method: SimMethod;
  let confidence: SimulationConfidence;
  let outcome: SimOutcome;

  const undelegated = opts.authorizationPresent ?? Boolean(batch.authorization);

  if (opts.gas === false) {
    method = "fallback";
    confidence = "unsupported";
    outcome = { success: true, gasUsed: FALLBACK_GAS };
  } else if (undelegated && deps.chain.capabilities.stateOverride) {
    method = "state-override";
    confidence = "exact";
    outcome = await stateOverrideMethod(deps.rpc, methodArgs);
  } else if (deps.chain.capabilities.simulateV1) {
    method = "eth_simulateV1";
    confidence = "exact";
    outcome = await simulateV1Method(deps.rpc, methodArgs);
  } else {
    // Every supported chain has simulateV1 + stateOverride (see registry capabilities). Fail loud on a
    // chain that has neither rather than silently degrading to a low-confidence estimate.
    throw new Error(
      `chain ${deps.chain.chainId} lacks eth_simulateV1 and state-override — cannot simulate the batch; add it to the registry with the required capabilities`,
    );
  }

  // SHOW WHAT IS SIGNED. The fee was priced ONCE, when the batch was resolved, and committed to
  // `feeCalls` — that is the amount the user's signature covers and the amount the relayer will move.
  //
  // This used to RE-PRICE it here from the simulation's own gas number, which is a DIFFERENT figure
  // (it omits the EIP-7702 authorization intrinsic and the fee transfer that `fullGasEstimate` covers).
  // The result was two fees in one SimulationResult: the app displayed one and the user signed the
  // other. On real hardware a send showed 0.001921 USDC and moved 0.004104. Never recompute a number
  // the user is about to sign.
  // Self-pay's counterpart is `batch.nativeFee` — an estimate, never signed. Same rule: surface what
  // the resolver computed, do not recompute it here from `outcome.gasUsed` (the inner-call gas alone).
  const fee: SimulationResult["fee"] = batch.fee;

  return {
    batch,
    success: outcome.success,
    gasEstimate: outcome.gasUsed,
    fee,
    nativeFee: batch.nativeFee,
    decodedCalls: decodeCalls(calls),
    disclosures: batch.disclosures,
    confidence,
    method,
    revertReason: outcome.revertReason,
  };
}
