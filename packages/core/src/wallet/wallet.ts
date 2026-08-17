import type { Address } from "viem";
import { encodeSelfHandle, handleLabel } from "./passkey/label.js";
import type { PasskeyAdapter } from "./passkey/adapter.js";
import { withNewPasskeyKey, type WalletState } from "./sandbox.js";

/** One identity. The EVM address is public. */
export interface AvokAccount {
  evm: Address;
}

export interface BirthResult {
  account: AvokAccount;
  state: WalletState;
}

/**
 * Create a wallet. The passkey IS the wallet (D8): K = HKDF(PRF), derived fresh on every login.
 * Zero tx, zero server, zero gas, zero stored bytes — and logging out cannot destroy it.
 *
 * This is also the primitive behind enrolling a SECOND device: every device runs this same ceremony
 * to derive its OWN independent key and address. What makes a device part of one wallet's roster is
 * an on-chain registration signed by an existing device (`wallet/device-enrollment.ts`), not anything
 * this function does — it only ever mints one fresh, self-contained key.
 */
export async function createWallet(args: {
  passkey: PasskeyAdapter;
  /** Operator/app label for the passkey display label. NEVER a user-identifying name. */
  networkName: string;
  now?: Date;
}): Promise<BirthResult> {
  const userHandle = encodeSelfHandle();
  return withNewPasskeyKey(
    { passkey: args.passkey, label: handleLabel(args.networkName, userHandle), userHandle },
    async (account, reg) => ({
      account: { evm: account.address },
      state: {
        evmAddress: account.address,
        walletAddress: account.address,
        credentialId: reg.credentialId,
        rpId: reg.rpId,
        createdAt: (args.now ?? new Date()).toISOString(),
      },
    }),
  );
}
