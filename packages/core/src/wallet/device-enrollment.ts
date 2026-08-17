/**
 * Device enrollment (D8): a new device derives its OWN key, independent of every other device's, and
 * proves control of it for a SPECIFIC wallet. An EXISTING signer then registers that address in the
 * wallet's on-chain roster (Calibur's `register(Key)`, a self-call the existing signer submits via
 * `execute(mode, executionData)` — see `evm/roster-signature.ts` for how a registered device's
 * signature is later recognized).
 *
 * There is no more "wrap K under the new device's PRF and ship it" — that was the PRF-blob/SAS
 * ceremony D8 replaces. K never travels between devices. What travels here is a public address and a
 * signature over a fixed, domain-separated message: proof this device holds the private key for that
 * address, and that it means to join THIS wallet specifically (not whichever wallet happens to see
 * the request first), nothing else.
 */
import { verifyMessage, getAddress, type Address, type Hex } from "viem";
import { encodeRosterHandle, handleLabel } from "./passkey/label.js";
import type { PasskeyAdapter } from "./passkey/adapter.js";
import { withNewPasskeyKey, type WalletState } from "./sandbox.js";

/** Bound to a version tag AND the target wallet, like every other signing surface this SDK exposes
 *  (see channel/authorize-proof.ts): binding the wallet means a proof shown to one operator's
 *  registration flow cannot be replayed to enroll the same device into a DIFFERENT wallet. */
function enrollmentProofMessage(walletAddress: Address): string {
  return ["Avok device enrollment v1", `wallet: ${getAddress(walletAddress)}`].join("\n");
}

/** What the new device hands to an existing signer for it to register on chain. */
export interface DeviceEnrollmentRequest {
  /** The new device's own derived address — the signer to add to the wallet's roster. */
  address: Address;
  /** The wallet this device is asking to join. Public (the invite already named it); carried here so
   *  the request is self-describing and the proof below is checked against it. */
  walletAddress: Address;
  /** Signature over {@link enrollmentProofMessage}, made by `address`'s own key. Proves this device
   *  controls the key it is asking to be registered, for THIS wallet specifically — an existing
   *  signer must not register an address it has not seen proof for, or a bystander's address could
   *  be added to someone's roster by mistake (never by attack: registration itself still requires an
   *  existing signer's own transaction, but a UI that skips this check could add the wrong device). */
  proof: Hex;
}

/**
 * Run on the NEW device. One passkey gesture: mint a fresh credential, derive its key, sign the proof,
 * wipe. Returns the request to hand to an existing device (out of band — QR, or any transport; see
 * `helpers/qr.ts`) plus the local `WalletState` this device now has for itself.
 *
 * `walletAddress` is known upfront — the inviting (existing) device names it, e.g. in the QR it shows.
 */
export async function createDeviceEnrollmentRequest(args: {
  passkey: PasskeyAdapter;
  networkName: string;
  walletAddress: Address;
  now?: Date;
}): Promise<{ request: DeviceEnrollmentRequest; state: WalletState }> {
  const userHandle = encodeRosterHandle(args.walletAddress);
  return withNewPasskeyKey(
    { passkey: args.passkey, label: handleLabel(args.networkName, userHandle), userHandle },
    async (account, reg) => {
      const proof = await account.signMessage({ message: enrollmentProofMessage(args.walletAddress) });
      return {
        request: { address: account.address, walletAddress: args.walletAddress, proof },
        state: {
          evmAddress: account.address,
          walletAddress: args.walletAddress,
          credentialId: reg.credentialId,
          rpId: reg.rpId,
          createdAt: (args.now ?? new Date()).toISOString(),
        },
      };
    },
  );
}

/**
 * Run on the EXISTING device before registering `request.address`: does the proof actually show
 * control of that address, for THIS wallet? A `false` here means refuse the enrollment — do not
 * register the address.
 */
export function verifyDeviceEnrollmentRequest(request: DeviceEnrollmentRequest): Promise<boolean> {
  return verifyMessage({
    address: request.address,
    message: enrollmentProofMessage(request.walletAddress),
    signature: request.proof,
  });
}
