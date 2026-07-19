import { type Address, type Hex, bytesToHex } from "viem";
import { encryptKeyBlob, decryptKeyBlob, type EncryptedKeyBlob } from "./crypto/blob.js";
import { assertContainerComplete, produceEvmKey, produceSolanaKey, type SecretContainer } from "./crypto/container.js";
import { deriveWalletKey } from "./crypto/derive-wallet.js";
import { encryptSlotMeta } from "./crypto/slot-meta.js";
import { evmAddress, solanaAddressFromSecret } from "./crypto/derive.js";
import { deriveSlotId, encodeFoundingHandle, encodeAccessHandle, handleLabel } from "./passkey/label.js";
import type { PasskeyAdapter, PasskeyRegistration, PasskeySlot } from "./passkey/adapter.js";
import { withDecryptedContainer, type WalletState } from "./sandbox.js";

/** One identity, two chains. EVM is the anchor; both addresses are public. */
export interface AvokAccount {
  evm: Address;
  solana: string;
}

function slotFrom(reg: PasskeyRegistration, createdAt: string): PasskeySlot {
  return { credentialId: reg.credentialId, rpId: reg.rpId, transports: reg.transports, createdAt };
}

/** Birth result. There is no `largeBlobBackedUp`: a primary stores nothing, so nothing can fail to store. */
export interface BirthResult {
  account: AvokAccount;
  state: WalletState;
}

/**
 * Create a wallet. The primary passkey IS the wallet: K = HKDF(PRF), derived fresh on every login.
 * Zero tx, zero server, zero gas, zero stored bytes — and logging out cannot destroy it.
 */
export async function createWallet(args: {
  passkey: PasskeyAdapter;
  /** Operator/app label for the passkey display label (e.g. rpId). NEVER the user's subname. */
  networkName: string;
  now?: Date;
}): Promise<BirthResult> {
  const userHandle = encodeFoundingHandle();
  // The label cannot name the address: we don't have one until the ceremony returns the PRF.
  const reg = await args.passkey.create(handleLabel(args.networkName, userHandle), userHandle);
  const container: SecretContainer = { key: await deriveWalletKey(reg.prfOutput) };
  try {
    const address = evmAddress(produceEvmKey(container));
    const solanaAddress = solanaAddressFromSecret(produceSolanaKey(container));
    return {
      account: { evm: address, solana: solanaAddress },
      state: {
        evmAddress: address,
        solanaAddress,
        slots: [slotFrom(reg, (args.now ?? new Date()).toISOString())],
        blobs: [],
      },
    };
  } finally {
    // Derive/use/clear: K was only needed to compute the (public) addresses. State holds no key.
    container.key.fill(0);
  }
}

/**
 * Enrol a SECONDARY credential for an existing wallet. The primary derives K from its own PRF and
 * holds no slot; a secondary cannot (its PRF differs), so it wraps the existing K under its own PRF
 * and the caller writes that ciphertext to the on-chain vault.
 *
 * The new credential learns K. That is permanent: removing its access slot later frees capacity, but a
 * credential that ever signed had K in memory and could have kept it. Removing an access slot is housekeeping,
 * never a security control — see buildRemoveAccessSlotCall.
 */
export async function addPasskey(args: {
  passkey: PasskeyAdapter;
  networkName: string;
  container: SecretContainer;
  address: Address;
  solanaAddress: string;
  /** The EVM anchor chain this secondary's access-slot blob is written to. Recorded IN the handle so any
   *  reader resolves the blob from the chain that holds it, not from its own app anchor. MUST equal
   *  the chain the caller submits the addAccessSlot ciphertext to. */
  anchorChainId: number;
  now?: Date;
}): Promise<{ slot: PasskeySlot; blob: EncryptedKeyBlob; encryptedMeta: Uint8Array }> {
  const userHandle = encodeAccessHandle(args.address, args.anchorChainId);
  const reg = await args.passkey.create(handleLabel(args.networkName, userHandle), userHandle);
  const blob = await encryptKeyBlob({
    container: args.container,
    address: args.address,
    credentialId: reg.credentialId,
    prfOutput: reg.prfOutput,
  });
  // The access slot's metadata: the enrolling rp-id, encrypted under a K-derived key and bound to this
  // access slot's id. Computed HERE because it needs K, and K must not leave wallet-core — the caller
  // gets ciphertext and writes it beside the blob.
  const encryptedMeta = await encryptSlotMeta(
    args.container.key,
    deriveSlotId(args.address, reg.credentialId),
    reg.rpId,
  );
  return { slot: slotFrom(reg, (args.now ?? new Date()).toISOString()), blob, encryptedMeta };
}

// Removing an access slot is aimed via buildRemoveAccessSlotCall (vault.ts) and listAccessSlots (roster.ts),
// not from here. It frees the slot; it is NOT a security control — see the note on
// buildRemoveAccessSlotCall.

/** Raw key material. Usable in MetaMask / Phantom. Deliberately NOT a 24-word phrase: no standard
 *  derivation path reproduces our HKDF chain, so a phrase would look restorable and restore nothing. */
export type ExportedWallet = { evm: Hex; solana: Hex };

/** Atomic export of the whole container as two raw private keys. Requires explicit confirmation —
 *  a "you are about to reveal private keys" gate, distinct from any passkey-removal decision. */
export async function exportWallet(args: {
  state: WalletState;
  passkey: PasskeyAdapter;
  credentialId?: string;
  confirmExport: true;
}): Promise<ExportedWallet> {
  if (args.confirmExport !== true) throw new Error("Wallet export requires explicit confirmation");
  // The export boundary is the ONE legitimate place K becomes a `Hex` string: the user pastes these
  // into MetaMask / Phantom. That string is immutable and CANNOT be wiped — inherent to letting a
  // human read a key. The container bytes are still zeroed by withDecryptedContainer's `finally`.
  return withDecryptedContainer(args, async (container) => ({
    evm: bytesToHex(produceEvmKey(container)),
    solana: bytesToHex(produceSolanaKey(container)),
  }));
}

/** Build the in-memory state for a PRIMARY from its wallet key K = HKDF(PRF). A primary holds no
 *  blob and no slot ciphertext — its addresses derive straight from K, and `continue()` rebuilds
 *  this offline on every login with no chain read. `blobs: []` is load-bearing: there is nothing to
 *  store, so nothing can fail to store or go unreachable. */
export function reconstructFromKey(key: Uint8Array): WalletState {
  const container: SecretContainer = { key };
  try {
    return {
      evmAddress: evmAddress(produceEvmKey(container)),
      solanaAddress: solanaAddressFromSecret(produceSolanaKey(container)),
      slots: [],
      blobs: [],
    };
  } finally {
    // Derive/use/clear, extended to the primary-reconstruction path: K was needed only to compute
    // the public addresses. Callers pass `deriveWalletKey(prfOutput)` inline and do not retain it,
    // so zeroing it here clears the last copy of K for that login on every consumer.
    key.fill(0);
  }
}

/**
 * Rebuild local state for a SECONDARY recovered on-chain on a fresh device. The blob no longer stores
 * the addresses, so we DECRYPT it (once) and DERIVE both addresses from K — exactly as createWallet
 * does — then wipe K. The caller supplies what the blob dropped: the wallet EVM address and the
 * credentialId (both from the secondary handle / discover() it used to FIND the blob), its own rpId
 * (cosmetic slot metadata), and this credential's PRF output (single-use, wiped here after decrypt).
 *
 * The consistency guard is now stronger than the old cross-slot compare: the address the K
 * derives MUST equal the handle's claimed address, or we refuse — a blob that decrypts to a different
 * wallet than its handle asserts is rejected, not silently trusted.
 */
export async function reconstructWalletState(args: {
  blob: EncryptedKeyBlob;
  /** Wallet EVM address from the secondary handle (handle.evm). */
  address: Address;
  /** The discovered credential that found this blob. */
  credentialId: string;
  /** The reading app's own rpId — cosmetic slot metadata; unused by the sign path. */
  rpId: string;
  /** This credential's PRF output. Consumed to decrypt K, then wiped (single-use). */
  prfOutput: ArrayBuffer;
}): Promise<WalletState> {
  // `decryptKeyBlob` runs INSIDE the try so the single-use PRF (K's seed) is wiped even when decrypt
  // itself throws — a wrong handle address or corrupt blob is a reachable failure, and leaving the PRF
  // un-zeroed on it would defeat derive/use/clear. `container` stays optional for that no-container path.
  let container: SecretContainer | undefined;
  try {
    container = await decryptKeyBlob(args.blob, args.prfOutput, args.address, args.credentialId);
    const evm = evmAddress(produceEvmKey(container));
    if (evm.toLowerCase() !== args.address.toLowerCase()) {
      throw new Error("Cannot reconstruct: blob decrypts to a different wallet than its handle (address mismatch)");
    }
    return {
      evmAddress: evm,
      solanaAddress: solanaAddressFromSecret(produceSolanaKey(container)),
      // Cosmetic slot metadata only. The blob carries no timestamp, so this records when this app
      // reconstructed the wallet, not when the credential was enrolled. The on-chain
      // AccessSlotAdded event is the authority on that.
      slots: [{ credentialId: args.credentialId, rpId: args.rpId, createdAt: new Date().toISOString() }],
      blobs: [{ credentialId: args.credentialId, blob: args.blob }],
    };
  } finally {
    // Derive/use/clear: K was needed only to derive the public addresses. The prfOutput is single-use
    // per the adapter contract and is not reused by any caller after this returns — wipe both.
    container?.key.fill(0);
    new Uint8Array(args.prfOutput).fill(0);
  }
}
