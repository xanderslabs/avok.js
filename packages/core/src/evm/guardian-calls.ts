/**
 * Guardian-set management — `setupGuardians`/`proposeGuardianOp`/`executeGuardianOp`/`vetoGuardianOp`
 * (`GuardianLogic.sol`, exposed on `AvokCaliburABI`'s combined ABI). All four are `onlySelf`, satisfied
 * the same self-call way as `roster-calls.ts`'s `register`/`revoke`: wrap the call in the wallet's own
 * `execute(mode, executionData)` batch. There is no new signing primitive here — these are ordinary
 * wallet actions, submitted through whatever this SDK already uses to send a batch.
 *
 * NOT INCLUDED: `approveRecovery`/`approveRecoveryBySig` and the read side of a pending recovery —
 * those are a GUARDIAN's own action (signed by the guardian's key, not the wallet's), and live in
 * `vault/recover/` per TDD §7 ("Recovery UX entry lives on the origin-point page"). This module is
 * the wallet OWNER managing who its guardians are, a different actor and a different surface.
 */
import { encodeFunctionData, type Address, type Hex } from "viem";
import { GuardianLogicABI } from "@avokjs/contracts";
import type { Call } from "./types.js";

export type GuardianOpKind = "add" | "remove" | "setThreshold";
const OP_KIND: Record<GuardianOpKind, number> = { add: 0, remove: 1, setThreshold: 2 };

/** Mirrors `IGuardianLogic.GuardianOp` exactly — `guardian`/`newThreshold` are both always present on
 *  the wire (the struct has no optional fields); callers set whichever the `kind` actually uses and
 *  leave the other at its zero value, matching what `GuardianLogic.sol`'s `_applyOp` itself ignores
 *  for that kind. */
export interface GuardianOp {
  kind: GuardianOpKind;
  guardian: Address;
  newThreshold: number;
  nonce: bigint;
}

function encodeOp(op: GuardianOp) {
  return { kind: OP_KIND[op.kind], guardian: op.guardian, newThreshold: op.newThreshold, nonce: op.nonce } as const;
}

/** First-time guardian setup — reverts (`AlreadySetup`) if the wallet already has guardians; use
 *  `buildProposeGuardianOpCall`/`buildExecuteGuardianOpCall` to change an existing set instead. */
export function buildSetupGuardiansCall(args: {
  wallet: Address;
  guardians: Address[];
  threshold: number;
  recoveryDelaySeconds: number;
  guardianOpDelaySeconds: number;
}): Call {
  const data = encodeFunctionData({
    abi: GuardianLogicABI,
    functionName: "setupGuardians",
    args: [args.guardians, args.threshold, args.recoveryDelaySeconds, args.guardianOpDelaySeconds],
  });
  return { to: args.wallet, value: 0n, data };
}

/** Open the timelock on a guardian-set change (add/remove/setThreshold) — vetoable for
 *  `guardianOpDelaySeconds` before `buildExecuteGuardianOpCall` can apply it. */
export function buildProposeGuardianOpCall(wallet: Address, op: GuardianOp): Call {
  const data = encodeFunctionData({ abi: GuardianLogicABI, functionName: "proposeGuardianOp", args: [encodeOp(op)] });
  return { to: wallet, value: 0n, data };
}

/** Apply a proposed op once its timelock has elapsed. Reverts (`OpNotReady`) if called early — the
 *  caller is expected to have read `getPendingGuardianOp`'s `readyAt` first. */
export function buildExecuteGuardianOpCall(wallet: Address, op: GuardianOp): Call {
  const data = encodeFunctionData({ abi: GuardianLogicABI, functionName: "executeGuardianOp", args: [encodeOp(op)] });
  return { to: wallet, value: 0n, data };
}

/** Cancel a pending guardian-set op before its timelock elapses. `opHash` is
 *  `keccak256(abi.encode(op))` — the same hash `GuardianOpProposed`'s event carries. */
export function buildVetoGuardianOpCall(wallet: Address, opHash: Hex): Call {
  const data = encodeFunctionData({ abi: GuardianLogicABI, functionName: "vetoGuardianOp", args: [opHash] });
  return { to: wallet, value: 0n, data };
}
