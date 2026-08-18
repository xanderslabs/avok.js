/**
 * The recovery screen's state machine — TDD §7 "Recovery UX entry": enter the wallet, read its
 * guardian state, mint this device's fresh promote key, then either branch (a) a connected guardian
 * wallet signs, or (b) an imported guardian key signs (materialize, sign, wipe — `approveWithImportedKey`
 * already does this; this module only drives it). Producing a signed, ready-to-relay `GuardianApproval`
 * is where this module's job ends — same scope boundary `vault/recover/flow.ts` documents for itself:
 * submitting it on-chain, and the veto/execute transactions, are ordinary wallet sends elsewhere, not
 * this screen's job.
 *
 * Framework-free and gesture-free by construction, same split as `ceremony.ts`/`view-dom.ts`: this file
 * is pure state + async transitions over injected `RecoverCeremonyDeps`, fully unit-testable without a
 * browser. `recover/mount.ts` wires the real gestures (WebAuthn, EIP-6963) and a DOM view drives this.
 */
import type { Address, Hex } from "viem";
import type { RecoveryFlow } from "../../vault/recover/flow.js";
import type { GuardianConfig, PendingRecovery } from "../../vault/recover/read.js";
import type { GuardianApproval, RecoveryApprovalTypedData } from "../../vault/recover/approve.js";

export interface RecoverCeremonyDeps {
  flow: RecoveryFlow;
  /** The anchor chain guardian state lives on (TDD §7: "V1 is anchor-chain-only") — see
   *  `recover/mount.ts` for how it is chosen from the Vault's configured chains. */
  chainId: number;
  /** Mint a FRESH passkey credential on this device and return its derived address — TDD §7: "the
   *  promoted key is the recovering device's fresh passkey-derived key." Registration only: the
   *  derived key itself is never returned or retained past this call, matching K's normal
   *  derive/use/wipe discipline (`wallet/sandbox.ts#withNewPasskeyKey`). It is re-derived from the
   *  SAME passkey once the promotion is live on chain, in an ordinary later login. */
  mintPromoteKey(): Promise<{ address: Address }>;
  /** EIP-6963 discovery + `eth_requestAccounts` + `eth_signTypedData_v4` against an injected guardian
   *  wallet. Resolves once an account is connected and ready to sign; `signTypedData` performs ONE
   *  signature over the exact `RecoveryApprovalTypedData` it is given. */
  connectGuardianWallet(): Promise<{
    address: Address;
    signTypedData: (typedData: RecoveryApprovalTypedData) => Promise<Hex>;
  }>;
}

export type RecoverState =
  | { step: "enter" }
  | { step: "resolving" }
  | { step: "guardian-state"; wallet: Address; config: GuardianConfig; pending: PendingRecovery | null }
  | {
      step: "approving";
      wallet: Address;
      config: GuardianConfig;
      pending: PendingRecovery | null;
      promoteKey: Address;
      /** A failed sign attempt (rejected in the connected wallet, a bad imported key) — surfaced
       *  INLINE rather than by dropping to the terminal "error" step, so a retry does not cost the
       *  user a second passkey ceremony for a NEW promote key. Same "keep the context, show the
       *  error alongside it" shape `ceremony.ts`'s own consent-retry loop already uses. */
      error?: string;
    }
  | { step: "submitted"; approval: GuardianApproval }
  | { step: "error"; message: string };

/**
 * The nonce a FRESH approval must carry. When a recovery is already pending, `pending.nonce` is the
 * live value the contract expects (per `readGuardianState`'s own doc comment, reliable except right
 * after a veto — a known, documented gap, not one this module can close: there is no public getter for
 * `GuardianLogic`'s raw `recoveryNonce` counter, only the pending-struct copy, which resets to 0 on
 * veto right along with everything else).
 *
 * When NOTHING is pending, this module has no on-chain read that names the correct nonce at all — the
 * same missing-getter gap. `0n` is the correct value for a wallet's first-ever recovery (the contract's
 * counter starts at 0 and only increments on veto/execute), and is assumed here. A wallet that has been
 * through a prior veto-or-executed recovery needs a HIGHER value this module cannot discover, and would
 * see `approveRecoveryBySig` revert `NonceUsed` downstream of this screen. Flagged for the founder;
 * the real fix is a public `recoveryNonce()` getter on the contract, out of scope for this JS package.
 */
function nonceFor(pending: PendingRecovery | null): bigint {
  return pending ? pending.nonce : 0n;
}

export function createRecoverCeremony(deps: RecoverCeremonyDeps): {
  getState(): RecoverState;
  enterWallet(nameOrAddress: string): Promise<void>;
  beginApproval(): Promise<void>;
  approveWithConnectedGuardian(): Promise<void>;
  approveWithImportedKey(privateKey: Hex): Promise<void>;
} {
  let state: RecoverState = { step: "enter" };

  return {
    getState: () => state,

    async enterWallet(nameOrAddress: string): Promise<void> {
      state = { step: "resolving" };
      try {
        const { wallet } = await deps.flow.enterWallet(nameOrAddress);
        const { config, pending } = await deps.flow.readGuardianState(wallet);
        state = { step: "guardian-state", wallet, config, pending };
      } catch (err) {
        state = { step: "error", message: (err as Error).message };
      }
    },

    async beginApproval(): Promise<void> {
      if (state.step !== "guardian-state") {
        throw new Error("beginApproval: call enterWallet first — there is no wallet to approve a recovery for");
      }
      const { wallet, config, pending } = state;
      // A wallet with no guardians has no approval path at all — refuse before the passkey ceremony,
      // not after, so a doomed recovery never costs the user a biometric prompt for nothing.
      if (config.guardians.length === 0) {
        state = { step: "error", message: "This wallet has no guardians configured — recovery is not available." };
        return;
      }
      const { address } = await deps.mintPromoteKey();
      state = { step: "approving", wallet, config, pending, promoteKey: address };
    },

    async approveWithConnectedGuardian(): Promise<void> {
      if (state.step !== "approving") {
        throw new Error("approveWithConnectedGuardian: not in the approving step — call beginApproval first");
      }
      const { wallet, config, pending, promoteKey } = state;
      try {
        const { address: guardian, signTypedData } = await deps.connectGuardianWallet();
        // Checked HERE, not just left to the contract's own `NotGuardian` revert: this screen never
        // submits on chain, so a revert downstream would never reach the user — the mismatch has to
        // be caught while the state to explain it (the roster just read) is still in hand.
        if (!config.guardians.some((g) => g.toLowerCase() === guardian.toLowerCase())) {
          state = {
            step: "approving",
            wallet,
            config,
            pending,
            promoteKey,
            error: `${guardian} is not a guardian of this wallet`,
          };
          return;
        }
        const approval = await deps.flow.approveAsConnectedGuardian({
          guardian,
          wallet,
          chainId: deps.chainId,
          promoteKey,
          nonce: nonceFor(pending),
          signTypedData,
        });
        state = { step: "submitted", approval };
      } catch (err) {
        state = { step: "approving", wallet, config, pending, promoteKey, error: (err as Error).message };
      }
    },

    async approveWithImportedKey(privateKey: Hex): Promise<void> {
      if (state.step !== "approving") {
        throw new Error("approveWithImportedKey: not in the approving step — call beginApproval first");
      }
      const { wallet, config, pending, promoteKey } = state;
      try {
        const approval = await deps.flow.approveWithImportedKey({
          privateKey,
          wallet,
          chainId: deps.chainId,
          promoteKey,
          nonce: nonceFor(pending),
        });
        state = { step: "submitted", approval };
      } catch (err) {
        state = { step: "approving", wallet, config, pending, promoteKey, error: (err as Error).message };
      }
    },
  };
}
