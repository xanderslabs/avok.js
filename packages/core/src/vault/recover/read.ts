/**
 * Reads against the wallet's own guardian storage — GuardianLogic is always reached by delegatecall
 * from the wallet (AvokCalibur), so `getGuardianConfig`/`getPendingRecovery` are called against the
 * WALLET's address, not GuardianLogic's own deployed address (contract-architecture §3).
 */
import { GuardianLogicABI } from "@avokjs/contracts";
import type { Address } from "viem";
import type { RpcClient } from "../../evm/rpc.js";

export interface GuardianConfig {
  guardians: Address[];
  threshold: number;
  recoveryDelaySeconds: number;
  guardianOpDelaySeconds: number;
}

export interface PendingRecovery {
  promoteKey: Address;
  /**
   * The nonce the NEXT `approveRecoveryBySig` call must carry. Reliable in the common case (no
   * guardian-set veto has happened since the wallet's last completed/absent recovery). NOT reliable
   * after a `vetoRecovery()`: the contract's actual replay counter (`recoveryNonce`) increments on
   * veto, but `getPendingRecovery()` only ever returns the PENDING struct's own nonce, which resets
   * to 0 on veto right along with everything else — so a post-veto first approval built from this
   * field can revert with `NonceUsed`. There is no public getter for the raw counter; surfacing that
   * gap here rather than guessing around it.
   */
  nonce: bigint;
  approvals: number;
  readyAt: number;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** `pending` is `null` when nothing is pending — same "absent, not a placeholder" rule as everywhere
 *  else in this codebase (an all-zero on-chain struct is not a recovery in progress). */
export async function readGuardianState(
  rpc: RpcClient,
  wallet: Address,
): Promise<{ config: GuardianConfig; pending: PendingRecovery | null }> {
  const [guardians, threshold, recoveryDelay, guardianOpDelay] = await rpc.readContract<
    [readonly Address[], number, number, number]
  >({ address: wallet, abi: GuardianLogicABI, functionName: "getGuardianConfig" });

  const [promoteKey, nonce, approvals, readyAt] = await rpc.readContract<[Address, bigint, number, number]>({
    address: wallet,
    abi: GuardianLogicABI,
    functionName: "getPendingRecovery",
  });

  return {
    config: {
      guardians: [...guardians],
      threshold,
      recoveryDelaySeconds: recoveryDelay,
      guardianOpDelaySeconds: guardianOpDelay,
    },
    pending: promoteKey === ZERO_ADDRESS ? null : { promoteKey, nonce, approvals, readyAt },
  };
}
