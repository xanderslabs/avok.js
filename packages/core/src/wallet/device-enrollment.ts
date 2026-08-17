/**
 * Device enrollment (D8): a new device derives its OWN key, independent of every other device's, and
 * proves control of it. An EXISTING signer then registers that address in the wallet's on-chain
 * roster (Calibur's `register(Key)` — the EVM/Calibur execution path that consumes this request is
 * built in a later task; this module only produces the request and lets it be verified).
 *
 * There is no more "wrap K under the new device's PRF and ship it" — that was the PRF-blob/SAS
 * ceremony D8 replaces. K never travels between devices. What travels here is a public address and a
 * signature over a fixed, domain-separated message: proof this device holds the private key for that
 * address, nothing else.
 */
import { verifyMessage, type Address, type Hex } from "viem";
import { handleLabel } from "./passkey/label.js";
import type { PasskeyAdapter } from "./passkey/adapter.js";
import { withNewPasskeyKey, type WalletState } from "./sandbox.js";

/** Bound to a version tag, like every other signing surface this SDK exposes (see
 *  channel/authorize-proof.ts): a wallet must never have two purposes recite the same string, or one
 *  becomes an oracle for producing signatures that pass as the other. */
const DEVICE_ENROLLMENT_PROOF = "Avok device enrollment v1";

/** What the new device hands to an existing signer for it to register on chain. */
export interface DeviceEnrollmentRequest {
  /** The new device's own derived address — the signer to add to the wallet's roster. */
  address: Address;
  /** Signature over {@link DEVICE_ENROLLMENT_PROOF}, made by `address`'s own key. Proves this device
   *  controls the key it is asking to be registered — an existing signer must not register an
   *  address it has not seen proof for, or a bystander's address could be added to someone's roster
   *  by mistake (never by attack: registration itself still requires an existing signer's
   *  transaction, but a UI that skips this check could add the wrong device). */
  proof: Hex;
}

/**
 * Run on the NEW device. One passkey gesture: mint a fresh credential, derive its key, sign the proof,
 * wipe. Returns the request to hand to an existing device (out of band — QR, or any transport; see
 * `helpers/qr.ts`) plus the local `WalletState` this device now has for itself.
 */
export async function createDeviceEnrollmentRequest(args: {
  passkey: PasskeyAdapter;
  networkName: string;
  now?: Date;
}): Promise<{ request: DeviceEnrollmentRequest; state: WalletState }> {
  const userHandle = crypto.getRandomValues(new Uint8Array(32));
  return withNewPasskeyKey(
    { passkey: args.passkey, label: handleLabel(args.networkName, userHandle), userHandle },
    async (account, reg) => {
      const proof = await account.signMessage({ message: DEVICE_ENROLLMENT_PROOF });
      return {
        request: { address: account.address, proof },
        state: {
          evmAddress: account.address,
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
 * control of that address? A `false` here means refuse the enrollment — do not register the address.
 */
export function verifyDeviceEnrollmentRequest(request: DeviceEnrollmentRequest): Promise<boolean> {
  return verifyMessage({
    address: request.address,
    message: DEVICE_ENROLLMENT_PROOF,
    signature: request.proof,
  });
}
