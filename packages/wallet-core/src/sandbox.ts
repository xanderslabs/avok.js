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
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58 } from "@scure/base";
import { decryptKeyBlob, type EncryptedKeyBlob } from "./crypto/blob.js";
import { type SecretContainer, produceEvmKey, produceSolanaKey } from "./crypto/container.js";
import { deriveWalletKey } from "./crypto/derive-wallet.js";
import { evmAddress, solanaAddressFromSecret } from "./crypto/derive.js";
import { decodeUserHandle } from "./passkey/label.js";
import type { PasskeyAdapter, PasskeySlot } from "./passkey/adapter.js";
import { resolveBlob } from "./resolution.js";
import type { VaultReader } from "./vault.js";
import type { AvokAssertionEvidence } from "./webauthn-evidence.js";

/** A trimmed on-chain blob paired with the credentialId that decrypts it. The blob itself no longer
 *  carries the id (it is public), so the in-memory state keeps the association out-of-band. */
export interface StoredBlob {
  credentialId: string;
  blob: EncryptedKeyBlob;
}

/** Local-only wallet state. Arrays so any enrolled device can unlock; no display name (nameless). */
export interface WalletState {
  evmAddress: Address;
  solanaAddress: string;
  slots: PasskeySlot[];
  blobs: StoredBlob[];
}

function pickSlot(state: WalletState, credentialId?: string): PasskeySlot {
  const slot = credentialId ? state.slots.find((s) => s.credentialId === credentialId) : state.slots[0];
  if (!slot) throw new Error("Passkey slot was not found");
  return slot;
}

/** @internal Reproduce the container for a slot from its PRF output. A PRIMARY holds no blob and
 *  derives K = HKDF(PRF) directly; a SECONDARY decrypts the stored ciphertext under its own PRF.
 *  Both reach an identical K, so the same wallet unlocks either way. */
function containerFor(state: WalletState, slot: PasskeySlot, prfOutput: ArrayBuffer): Promise<SecretContainer> {
  const stored = state.blobs.find((b) => b.credentialId === slot.credentialId);
  // The blob no longer self-describes: re-supply the wallet EVM address (state.evmAddress) and the
  // slot's credentialId so decrypt reproduces the exact AES info/slot binding.
  return stored
    ? decryptKeyBlob(stored.blob, prfOutput, state.evmAddress, slot.credentialId)
    : deriveWalletKey(prfOutput).then((key) => ({ key }));
}

/** @internal One passkey gesture → decrypt/derive → validated container. Both rails build on this.
 *  Derive/use/clear: the container key K and the PRF output are zeroed in `finally`, so a throwing
 *  `fn` still wipes. Every EVM/Solana entry point funnels through here (or withDiscoveredContainer),
 *  so the wipe is guaranteed in one place rather than duplicated per entry point. */
export async function withDecryptedContainer<T>(
  args: { state: WalletState; passkey: PasskeyAdapter; credentialId?: string },
  fn: (container: SecretContainer) => Promise<T>,
): Promise<T> {
  const slot = pickSlot(args.state, args.credentialId);
  const prfOutput = await args.passkey.authenticate(slot.credentialId, slot.transports);
  const container = await containerFor(args.state, slot, prfOutput);
  try {
    return await fn(container);
  } finally {
    wipeSecrets(container, prfOutput);
  }
}

/** Zero the wallet key K and the PRF output — the two most sensitive secrets a gesture touches
 *  (K = HKDF(prfOutput), so prfOutput is the seed that reproduces the key). Any signing account
 *  built from the container captures `container.key` by reference, so this also renders that account
 *  inert once the sandbox exits — exactly the intent: no derived key survives the gesture.
 *
 *  Wiping prfOutput is safe because it is consumed EXACTLY ONCE per path (containerFor →
 *  deriveWalletKey/decryptKeyBlob; the discover and evidence variants each read it once) BEFORE this
 *  runs, and because the PasskeyAdapter contract (passkey/adapter.ts) transfers the buffer to the
 *  sandbox single-use: every adapter MUST return a fresh buffer per call and MUST NOT retain/reuse
 *  it. Production adapters (passkey/web.ts, passkey/native.ts) already do — they mint a fresh PRF
 *  output per assertion and never keep it. */
function wipeSecrets(container: SecretContainer, prfOutput: ArrayBuffer): void {
  container.key.fill(0);
  new Uint8Array(prfOutput).fill(0);
}

const ADDRESS_MISMATCH = "Decrypted wallet did not match the stored wallet address";

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
  const recovered = secp256k1.sign(hexToBytes(hash), keyBytes, { lowS: true, extraEntropy: false, prehash: false, format: "recovered" });
  const sig = secp256k1.Signature.fromBytes(recovered, "recovered");
  // `format: "recovered"` guarantees a recovery bit; the type widens it to optional, so pin it.
  const yParity = sig.recovery ?? 0;
  return { r: numberToHex(sig.r, { size: 32 }), s: numberToHex(sig.s, { size: 32 }), v: yParity ? 28n : 27n, yParity };
}

// @internal The single EVM derivation + address-match check. Builds a viem custom account whose
// sign closures call signDigest over the BYTES key (captured by reference); every EVM sandbox entry
// point funnels through it. No Hex private key exists — only the public key/address are strings.
// The account is inert once the funnel wipes container.key (the closures share that buffer).
function evmAccountFrom(container: SecretContainer, expectedAddress: Address): PrivateKeyAccount {
  const keyBytes = produceEvmKey(container);
  const publicKey = bytesToHex(secp256k1.getPublicKey(keyBytes, false));
  const address = publicKeyToAddress(publicKey);
  if (address.toLowerCase() !== expectedAddress.toLowerCase()) throw new Error(ADDRESS_MISMATCH);
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
      const sig = signDigest(hashAuthorization({ address: address2, chainId: auth.chainId, nonce: auth.nonce }), keyBytes);
      return { address: address2, chainId: auth.chainId, nonce: auth.nonce, ...sig };
    },
  });
  // Mirror privateKeyToAccount's public shape so the exported PrivateKeyAccount type is unchanged.
  return { ...account, publicKey, source: "privateKey" } as PrivateKeyAccount;
}

// @internal The single Solana derivation + address-match check. The ed25519 secret stays in the
// returned signer's closure and is never surfaced; every Solana sandbox entry point funnels through
// it. The secret is derived from container.key (which the funnel wipes); the derived secret itself
// is a transient not separately zeroed — see the report's residuals.
function solanaSignerFrom(container: SecretContainer, expectedAddress: string): SolanaSigner {
  const secret = produceSolanaKey(container);
  const publicKey = ed25519.getPublicKey(secret);
  const address = base58.encode(publicKey);
  if (address !== expectedAddress) throw new Error("Decrypted wallet did not match the stored Solana address");
  return { publicKey, address, sign: (message) => Promise.resolve(ed25519.sign(message, secret)) };
}

/** Public signing primitive: yields a signing account only — never the raw key. One passkey gesture
 *  → reproduce PRF → decrypt/derive → run `fn(account)` → wipe K + PRF (in the funnel's `finally`).
 *  Keep `fn` to signing/re-encryption — do IO before/after, never inside, since K is zeroed on exit. */
export async function withWalletKey<T>(
  args: { state: WalletState; passkey: PasskeyAdapter; credentialId?: string },
  fn: (account: PrivateKeyAccount) => Promise<T>,
): Promise<T> {
  return withDecryptedContainer(args, (container) => fn(evmAccountFrom(container, args.state.evmAddress)));
}

/**
 * ONE gesture yielding BOTH the container (to seal a blob under K) and a signing account (to sign the
 * transaction that carries it).
 *
 * Enrolment needs K twice — encrypt the access slot's blob, then sign the write — and doing those through
 * two separate primitives opened two key scopes, so ONE "add this device" asked the user for TWO
 * biometric confirmations. This exists so it asks once.
 *
 * Same contract as `withWalletKey`: `fn` does signing and re-encryption ONLY. Do the chain IO before
 * and after — K is live for the whole of `fn` and is wiped on exit, and an RPC round-trip inside would
 * extend the key's lifetime in memory for no reason. (The access-slot write's calldata is a FIXED length —
 * BLOB_BYTES + META_BYTES are constants — so the caller can resolve nonce, gas and fee from a
 * same-sized probe BEFORE opening this scope, and needs no IO inside it.)
 */
export async function withWalletKeyAndContainer<T>(
  args: { state: WalletState; passkey: PasskeyAdapter; credentialId?: string },
  fn: (scope: { container: SecretContainer; account: PrivateKeyAccount }) => Promise<T>,
): Promise<T> {
  return withDecryptedContainer(args, (container) =>
    fn({ container, account: evmAccountFrom(container, args.state.evmAddress) }),
  );
}

/** @internal Single discover() gesture → (container, state), branching on the credential's handle.
 *  A PRIMARY carries no addresses and no blob: it derives K = HKDF(PRF) and reconstructs its state
 *  offline — no vault needed. A SECONDARY carries the wallet's addresses in its handle: its blob is
 *  resolved from the on-chain vault and decrypted under the discover() PRF. prfOutput stays local;
 *  container is passed to fn and never returned. Distinct from withDecryptedContainer, which uses
 *  authenticate() (a second gesture) for the local rails. */
async function withDiscoveredContainer<T>(
  args: { passkey: PasskeyAdapter; vaultForChain?: (chainId: number) => VaultReader; credentialId?: string },
  fn: (container: SecretContainer, state: WalletState, meta: { credentialId: string }) => Promise<T>,
): Promise<T> {
  // `args.credentialId` constrains the assertion (no account picker). `credentialId` below is the one
  // ACTUALLY used, handed to fn so a caller can record it — from the gesture it is already
  // performing, never a second prompt.
  const { credentialId, prfOutput, userHandle } = await args.passkey.discover(
    args.credentialId ? { credentialId: args.credentialId } : undefined,
  );
  const handle = decodeUserHandle(userHandle);

  let container: SecretContainer;
  let state: WalletState;
  if (handle.kind === "primary") {
    container = { key: await deriveWalletKey(prfOutput) };
    const address = evmAddress(produceEvmKey(container));
    const solanaAddress = solanaAddressFromSecret(produceSolanaKey(container));
    // A primary has no expected address to compare against — the derived address IS the identity —
    // so there is no ADDRESS_MISMATCH check here, and nothing is missing by its absence.
    state = {
      evmAddress: address,
      solanaAddress,
      slots: [{ credentialId, rpId: "", createdAt: new Date().toISOString() }],
      blobs: [],
    };
  } else {
    // Secondary: the handle carries the wallet's addresses AND the anchor chain its blob was written
    // to. Resolve the vault from THAT marker chain — never a single app-configured anchor — so a
    // reader whose own app anchor differs still reads the chain that actually holds the ciphertext.
    if (!args.vaultForChain) throw new Error("A secondary credential needs a vault resolver to reach its access-slot blob");
    const anchorVault = args.vaultForChain(handle.anchorChain);
    const result = await resolveBlob({ address: handle.evm, credentialId, anchorVault });
    if (!result) throw new Error("Encrypted blob for passkey slot was not found");
    const blob = result.blob;
    // The blob carries no addresses now: decrypt under the handle's EVM address (bound into the AES
    // info) + the discovered credentialId, then DERIVE both addresses from K. A wrong handle address
    // fails the AES tag; a blob whose K disagrees with the handle is caught by the explicit check.
    container = await decryptKeyBlob(blob, prfOutput, handle.evm, credentialId);
    try {
      const evm = evmAddress(produceEvmKey(container));
      if (evm.toLowerCase() !== handle.evm.toLowerCase()) throw new Error(ADDRESS_MISMATCH);
      state = {
        evmAddress: evm,
        solanaAddress: solanaAddressFromSecret(produceSolanaKey(container)),
        slots: [{ credentialId, rpId: "", createdAt: new Date().toISOString() }],
        blobs: [{ credentialId, blob }],
      };
    } catch (e) {
      wipeSecrets(container, prfOutput);
      throw e;
    }
  }
  // Derive/use/clear for both rails: wipe K and the PRF output even if `fn` throws.
  try {
    return await fn(container, state, { credentialId });
  } finally {
    wipeSecrets(container, prfOutput);
  }
}

/**
 * Gesture-collapse primitive for shared-origin sign-in. A single `discover()` assertion (one biometric
 * prompt) provides both the credential's handle AND the PRF output. A primary reconstructs K from
 * the PRF directly; a secondary resolves its ciphertext from `anchorVault` and decrypts it. No
 * second `authenticate()` call is made. The private key and PRF output are function-locals; never
 * returned or retained.
 */
export async function withDiscoveredWalletKey<T>(
  args: { passkey: PasskeyAdapter; vaultForChain?: (chainId: number) => VaultReader },
  fn: (account: PrivateKeyAccount, state: WalletState) => Promise<T>,
): Promise<T> {
  return withDiscoveredContainer(args, async (container, state) => {
    return fn(evmAccountFrom(container, state.evmAddress), state);
  });
}

/** Gesture-collapse Solana primitive: single discover() → decrypt → ed25519 signer.
 *  The key stays in the closure and is never returned. */
export async function withDiscoveredSolanaKey<T>(
  args: { passkey: PasskeyAdapter; vaultForChain?: (chainId: number) => VaultReader },
  fn: (signer: SolanaSigner, state: WalletState) => Promise<T>,
): Promise<T> {
  return withDiscoveredContainer(args, async (container, state) => {
    return fn(solanaSignerFrom(container, state.solanaAddress), state);
  });
}

/** Minimal Solana signer: ed25519 over raw bytes. S-2 wraps this for transactions. */
export type SolanaSigner = {
  publicKey: Uint8Array;
  address: string;
  sign(message: Uint8Array): Promise<Uint8Array>;
};

/**
 * Gesture-collapse primitive for BOTH rails: a single `discover()` assertion (one biometric
 * prompt) decrypts the wallet once and yields the EVM account AND the Solana signer together.
 * Use this when one flow needs to prove/sign on both chains at once — e.g. shared-origin login that
 * proves control of both addresses — without a second passkey gesture.
 *
 * Both keys are function-locals inside the closure; never returned or retained.
 */
export async function withDiscoveredKeys<T>(
  args: { passkey: PasskeyAdapter; vaultForChain?: (chainId: number) => VaultReader; credentialId?: string },
  fn: (
    keys: { evm: PrivateKeyAccount; solana: SolanaSigner },
    state: WalletState,
    meta: { credentialId: string },
  ) => Promise<T>,
): Promise<T> {
  return withDiscoveredContainer(args, async (container, state, meta) => {
    const evm = evmAccountFrom(container, state.evmAddress);
    const solana = solanaSignerFrom(container, state.solanaAddress);
    return fn({ evm, solana }, state, meta);
  });
}

/** Public Solana signing primitive: one passkey gesture; the key never leaves the closure. */
export async function withSolanaKey<T>(
  args: { state: WalletState; passkey: PasskeyAdapter; credentialId?: string },
  fn: (signer: SolanaSigner) => Promise<T>,
): Promise<T> {
  return withDecryptedContainer(args, async (container) => {
    return fn(solanaSignerFrom(container, args.state.solanaAddress));
  });
}

/** Like withWalletKey, but the gesture also yields a server-verifiable assertion over `challenge`. */
export async function withWalletKeyAndEvidence<T>(
  args: { state: WalletState; passkey: PasskeyAdapter; credentialId?: string; challenge: string },
  fn: (account: PrivateKeyAccount) => Promise<T>,
): Promise<{ result: T; assertion: AvokAssertionEvidence }> {
  if (!args.passkey.authenticateWithEvidence) {
    throw new Error("Passkey adapter does not support evidence capture");
  }
  const slot = pickSlot(args.state, args.credentialId);
  const { prfOutput, assertion } = await args.passkey.authenticateWithEvidence(slot.credentialId, slot.transports, args.challenge);
  const container = await containerFor(args.state, slot, prfOutput);
  try {
    const result = await fn(evmAccountFrom(container, args.state.evmAddress));
    return { result, assertion };
  } finally {
    wipeSecrets(container, prfOutput);
  }
}
