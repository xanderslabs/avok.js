/**
 * `startRecoveryFlow` — the recovery screen's four steps (TDD §7 "Recovery UX entry"), as one object
 * a caller drives step by step: enter the wallet, read its guardian state, get a guardian's approval
 * (either signing path), and show what's vetoable. Nothing here submits a transaction — the delay/veto
 * window and `executeRecovery()` itself are ordinary wallet reads/sends elsewhere in the SDK, not this
 * module's job; this module's job stops at producing a valid, ready-to-relay guardian approval.
 */
import { getAddress, isAddress, type Address, type Hex } from "viem";
import type { RpcClient } from "../../evm/rpc.js";
import { readGuardianState, type GuardianConfig, type PendingRecovery } from "./read.js";
import {
  approveAsConnectedGuardian,
  approveWithImportedKey,
  type GuardianApproval,
  type RecoveryApprovalTypedData,
} from "./approve.js";

export interface RecoveryFlow {
  /** Step 1: resolve what the user typed (an address, or an ENS-style name via the injected
   *  resolver) to the wallet under recovery. */
  enterWallet(nameOrAddress: string): Promise<{ wallet: Address }>;
  /** Step 2: read the guardian roster/threshold and any pending recovery from the wallet itself. */
  readGuardianState(wallet: Address): Promise<{ config: GuardianConfig; pending: PendingRecovery | null }>;
  /** Step 3a: a connected guardian wallet signs via its own EIP-712 provider. */
  approveAsConnectedGuardian(args: {
    guardian: Address;
    wallet: Address;
    chainId: number;
    promoteKey: Address;
    nonce: bigint;
    signTypedData: (typedData: RecoveryApprovalTypedData) => Promise<Hex>;
  }): Promise<GuardianApproval>;
  /** Step 3b: an imported raw key signs locally (materialize, sign, wipe). */
  approveWithImportedKey(args: {
    privateKey: Hex;
    wallet: Address;
    chainId: number;
    promoteKey: Address;
    nonce: bigint;
  }): Promise<GuardianApproval>;
  /** Step 4: the veto view — whatever is currently pending, so the caller can render the vetoable
   *  window. `canVeto` names the fact, not a permission check (any current full signer can veto). */
  vetoView(wallet: Address): Promise<{ pending: PendingRecovery | null; canVeto: boolean }>;
}

export function startRecoveryFlow(opts: {
  rpc: RpcClient;
  resolveName: (name: string) => Promise<Address | null>;
}): RecoveryFlow {
  return {
    async enterWallet(nameOrAddress: string) {
      if (isAddress(nameOrAddress)) return { wallet: getAddress(nameOrAddress) };
      const resolved = await opts.resolveName(nameOrAddress);
      if (!resolved) throw new Error(`Could not resolve "${nameOrAddress}" to a wallet address`);
      return { wallet: getAddress(resolved) };
    },

    readGuardianState: (wallet) => readGuardianState(opts.rpc, wallet),

    approveAsConnectedGuardian,
    approveWithImportedKey,

    async vetoView(wallet: Address) {
      const { pending } = await readGuardianState(opts.rpc, wallet);
      return { pending, canVeto: pending !== null };
    },
  };
}
