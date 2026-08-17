import type { Address, Hex } from "viem";
import {
  bytesToHex,
  hexToBytes,
  numberToHex,
  serializeSignature,
  keccak256,
  hashMessage,
  hashTypedData,
  serializeTransaction,
} from "viem";
import { hashAuthorization } from "viem/utils";
import { toAccount, publicKeyToAddress, type PrivateKeyAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { type SecretContainer, produceEvmKey } from "./crypto/container.js";
import { deriveWalletKey } from "./crypto/derive-wallet.js";
import { evmAddress } from "./crypto/derive.js";
import type { PasskeyAdapter, PasskeyRegistration } from "./passkey/adapter.js";
import { decodeUserHandle } from "./passkey/label.js";

/**
 * Local-only wallet state (D8): ONE credential, ONE derived key, ONE address, all on THIS device.
 *
 * There is no more multi-slot roster here — under the old PRF-blob scheme, several credentials could
 * all decrypt their way to the SAME shared K, and this array held all of them. Under D8 every device
 * derives its OWN independent K and address; the set of signers that can act for one wallet lives
 * on chain (the Calibur roster), not in local state. This type is just "what this device's own
 * passkey resolves to."
 *
 * `evmAddress` and `walletAddress` COINCIDE for the founding device and DIFFER for every device
 * enrolled later: a roster device's own key is a registered Calibur signer, not the wallet's own
 * EIP-7702 delegate address. Callers that sign ON BEHALF of the wallet (perform-sign.ts) need both —
 * `evmAddress` says whose key actually signs, `walletAddress` says which account the signature must
 * authorize.
 */
export interface WalletState {
  evmAddress: Address;
  walletAddress: Address;
  credentialId: string;
  rpId: string;
  createdAt: string;
}

/** @internal Sign a 32-byte digest with the secp256k1 private key given as raw BYTES.
 *
 * This reproduces viem's own `sign` primitive (accounts/utils/sign.ts) exactly — deterministic
 * RFC-6979 (`extraEntropy: false`), low-S, `v = recovery ? 28 : 27`, `yParity = recovery`, r/s as
 * 32-byte hex — but takes a `Uint8Array` key so no `Hex` private-key string is ever constructed.
 * `prehash: false` is REQUIRED: @noble/curves v2 sha256-prehashes by default, whereas the digest
 * passed here is already the final hash (keccak256 / EIP-191 / EIP-712). The equivalence to viem
 * was verified byte-for-byte across message/typed-data/transaction/authorization signing. The
 * produced signature is public — only the key is secret, and the key is bytes wiped by the funnel. */
function signDigest(hash: Hex, keyBytes: Uint8Array): { r: Hex; s: Hex; v: bigint; yParity: number } {
  const recovered = secp256k1.sign(hexToBytes(hash), keyBytes, {
    lowS: true,
    extraEntropy: false,
    prehash: false,
    format: "recovered",
  });
  const sig = secp256k1.Signature.fromBytes(recovered, "recovered");
  // `format: "recovered"` guarantees a recovery bit; the type widens it to optional, so pin it.
  const yParity = sig.recovery ?? 0;
  return { r: numberToHex(sig.r, { size: 32 }), s: numberToHex(sig.s, { size: 32 }), v: yParity ? 28n : 27n, yParity };
}

const ADDRESS_MISMATCH = "Derived key did not match the expected wallet address";

/**
 * @internal The single EVM derivation + optional address-match check. Builds a viem custom account
 * whose sign closures call signDigest over the BYTES key (captured by reference); every EVM sandbox
 * entry point funnels through it. No Hex private key exists — only the public key/address are
 * strings. The account is inert once the funnel wipes container.key (the closures share that buffer).
 *
 * `expectedAddress` is omitted for a FRESH key (nothing to compare against yet — the derived address
 * IS the identity) and supplied when re-authenticating an EXISTING device's own credential.
 */
function evmAccountFrom(container: SecretContainer, expectedAddress?: Address): PrivateKeyAccount {
  const keyBytes = produceEvmKey(container);
  const publicKey = bytesToHex(secp256k1.getPublicKey(keyBytes, false));
  const address = publicKeyToAddress(publicKey);
  if (expectedAddress && address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(ADDRESS_MISMATCH);
  }
  const account = toAccount({
    address,
    async sign({ hash }) {
      return serializeSignature(signDigest(hash, keyBytes));
    },
    async signMessage({ message }) {
      return serializeSignature(signDigest(hashMessage(message), keyBytes));
    },
    async signTypedData(typedData) {
      return serializeSignature(signDigest(hashTypedData(typedData as Parameters<typeof hashTypedData>[0]), keyBytes));
    },
    async signTransaction(transaction, options) {
      const serializer = options?.serializer ?? serializeTransaction;
      // Match viem: for EIP-4844 sign the payload body without sidecars.
      const signable = transaction.type === "eip4844" ? { ...transaction, sidecars: false } : transaction;
      const sig = signDigest(keccak256(await serializer(signable)), keyBytes);
      return serializer(transaction, sig);
    },
    async signAuthorization(authorization) {
      const auth = authorization as { address?: Address; contractAddress?: Address; chainId: number; nonce: number };
      const address2 = (auth.contractAddress ?? auth.address) as Address;
      const sig = signDigest(
        hashAuthorization({ address: address2, chainId: auth.chainId, nonce: auth.nonce }),
        keyBytes,
      );
      return { address: address2, chainId: auth.chainId, nonce: auth.nonce, ...sig };
    },
  });
  // Mirror privateKeyToAccount's public shape so the exported PrivateKeyAccount type is unchanged.
  return { ...account, publicKey, source: "privateKey" } as PrivateKeyAccount;
}

/** Zero the wallet key K and the PRF output — the two most sensitive secrets a gesture touches
 *  (K = HKDF(prfOutput), so prfOutput is the seed that reproduces the key). Any signing account
 *  built from the container captures `container.key` by reference, so this also renders that account
 *  inert once the sandbox exits — exactly the intent: no derived key survives the gesture. */
function wipeSecrets(container: SecretContainer | undefined, prfOutput: ArrayBuffer): void {
  container?.key.fill(0);
  new Uint8Array(prfOutput).fill(0);
}

/** Public signing primitive: yields a signing account only — never the raw key. One passkey gesture
 *  → reproduce PRF → derive K → run `fn(account)` → wipe K + PRF (in the funnel's `finally`).
 *  Keep `fn` to signing only — do IO before/after, never inside, since K is zeroed on exit. */
export async function withWalletKey<T>(
  args: { state: WalletState; passkey: PasskeyAdapter },
  fn: (account: PrivateKeyAccount) => Promise<T>,
): Promise<T> {
  const prfOutput = await args.passkey.authenticate(args.state.credentialId);
  let container: SecretContainer | undefined;
  try {
    container = { key: await deriveWalletKey(prfOutput) };
    return await fn(evmAccountFrom(container, args.state.evmAddress));
  } finally {
    wipeSecrets(container, prfOutput);
  }
}

/**
 * Gesture-collapse primitive: a single `discover()` assertion (one biometric prompt) derives THIS
 * device's key and yields both the signing account and the local state describing it. Used at login,
 * when the caller does not yet know which credential (of possibly several the platform offers) the
 * user will pick.
 *
 * The key is a function-local inside the closure; never returned or retained.
 */
export async function withDiscoveredKeys<T>(
  args: { passkey: PasskeyAdapter; credentialId?: string },
  fn: (keys: { evm: PrivateKeyAccount }, state: WalletState, meta: { credentialId: string }) => Promise<T>,
): Promise<T> {
  const { credentialId, prfOutput, userHandle } = await args.passkey.discover(
    args.credentialId ? { credentialId: args.credentialId } : undefined,
  );
  let container: SecretContainer | undefined;
  try {
    container = { key: await deriveWalletKey(prfOutput) };
    const account = evmAccountFrom(container);
    // The handle says which wallet this credential signs for: itself (founding device) or a
    // different one (roster device, enrolled later) — see WalletState's doc comment.
    const handle = decodeUserHandle(userHandle);
    const walletAddress = handle.kind === "roster" ? handle.walletAddress : account.address;
    const state: WalletState = {
      evmAddress: account.address,
      walletAddress,
      credentialId,
      rpId: "",
      createdAt: new Date().toISOString(),
    };
    return await fn({ evm: account }, state, { credentialId });
  } finally {
    wipeSecrets(container, prfOutput);
  }
}

/**
 * Mint a FRESH passkey credential and derive its key in the same gesture — the primitive behind both
 * wallet creation (the first device) and device enrollment (every later device: it derives its own
 * key, independent of every other device's). `fn` runs while K is live; do IO before/after, not
 * inside, since K is wiped on exit.
 */
export async function withNewPasskeyKey<T>(
  args: { passkey: PasskeyAdapter; label: string; userHandle: Uint8Array },
  fn: (account: PrivateKeyAccount, registration: PasskeyRegistration) => Promise<T>,
): Promise<T> {
  const registration = await args.passkey.create(args.label, args.userHandle);
  let container: SecretContainer | undefined;
  try {
    container = { key: await deriveWalletKey(registration.prfOutput) };
    return await fn(evmAccountFrom(container), registration);
  } finally {
    wipeSecrets(container, registration.prfOutput);
  }
}

// Re-exported so wallet.ts and device-enrollment.ts (both build on this primitive) do not need a
// second copy of the derive/wipe funnel just to compute an address without signing anything.
export { evmAddress, deriveWalletKey };
