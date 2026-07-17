import { stringToBytes, type Address, type Hex } from "viem";
import { bytesToArrayBuffer } from "../encoding.js";
import { deriveSlotId } from "../passkey/label.js";
import { HKDF_SALT, SLOT_INFO_PREFIX } from "./derive-wallet.js";
import { type SecretContainer, deserializeContainer, serializeContainer } from "./container.js";

/**
 * The blob version this implementation WRITES. 0 while the ERC is a Draft.
 *
 * ⚠️ NEVER bump this without adding the old version to SUPPORTED_BLOB_VERSIONS first.
 */
export const BLOB_VERSION = 0 as const;

/**
 * Every version this implementation can READ.
 *
 * 🔴 THE RULE: ADD TO THIS SET. NEVER REMOVE FROM IT.
 *
 * An access-slot blob is written to PUBLIC CHAIN STORAGE, is immutable, and IS the recovery path —
 * it is the only way a passkey reaches the wallet key. Dropping a version from this set permanently
 * locks every wallet whose access slot was written under it OUT OF ITS OWN FUNDS, with no remedy: the blob
 * on chain cannot be rewritten by anyone, including us.
 *
 * This is why the reader is a SET and the writer is a single constant. A format change bumps
 * BLOB_VERSION (new writes use it) and appends the old value here (old access slots keep opening, forever).
 * The two must never be conflated: `bytes[0] !== BLOB_VERSION` — an equality check against the
 * writer — would have bricked every existing wallet the first time the version moved.
 */
export const SUPPORTED_BLOB_VERSIONS = [0] as const;
export type BlobVersion = (typeof SUPPORTED_BLOB_VERSIONS)[number];

const IV_BYTES = 12;
const CIPHERTEXT_BYTES = 48; // 32-byte key + 16-byte AES-GCM tag
export const BLOB_BYTES = 1 + IV_BYTES + CIPHERTEXT_BYTES; // 61

/** Byte length of each readable version. A future version may change the layout, so the length is
 *  validated PER VERSION — the version byte must be read before the length can be judged. */
const BLOB_BYTES_BY_VERSION: Record<BlobVersion, number> = { 0: BLOB_BYTES };

export function isSupportedBlobVersion(v: number): v is BlobVersion {
  return (SUPPORTED_BLOB_VERSIONS as readonly number[]).includes(v);
}

/** PRF-encrypted wallet key, trimmed to the decrypt-minimum. This lands PUBLICLY on chain via
 *  `addAccessSlot`, so it carries NOTHING that fingerprints a user: no address, no credentialId, no
 *  rpId, no transports. Everything needed to decrypt is re-supplied by the caller at resolution
 *  time — the wallet address (from the credential's user handle) and the credentialId (from
 *  discover()).
 *
 *  Canonical binary, never JSON: JSON has no canonical byte encoding, so two conforming
 *  implementations could produce different bytes for the same blob. The fixed 61-byte layout is also
 *  measurably cheaper to store — 115,310 gas versus 181,934 for the old 156-byte JSON envelope, a
 *  saving of 66,624 gas (~37%) on every access-slot write. Both figures are measured cold with
 *  non-zero ciphertext by contracts/test/GasMeasure.t.sol, which pins them. */
export interface EncryptedKeyBlob {
  version: BlobVersion;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export const WRAPPING_KEY_BYTES = 32;

/**
 * The slot's AES key as raw BITS. HKDF-SHA256(PRF), `info` binding address + derived slot id (no key
 * reuse across wallets/slots). SLOT_INFO_PREFIX MUST stay distinct from WALLET_INFO — see
 * derive-wallet.ts.
 *
 * BOTH `info` inputs are PUBLIC, and that is load-bearing: it is what lets an ENROLLER derive this key
 * ALONE, from its own PRF, and send it to the holder instead of receiving K (see enrolment.ts).
 * Extractable on purpose — treat the bytes as key material and wipe them after use.
 */
export async function deriveSlotWrappingKeyBits(
  prfOutput: ArrayBuffer,
  address: Address,
  credentialId: string,
): Promise<Uint8Array> {
  const slotId: Hex = deriveSlotId(address, credentialId);
  const baseKey = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: bytesToArrayBuffer(stringToBytes(HKDF_SALT)),
      info: bytesToArrayBuffer(stringToBytes(`${SLOT_INFO_PREFIX}|${address.toLowerCase()}|${slotId}`)),
    },
    baseKey,
    WRAPPING_KEY_BYTES * 8,
  );
  const out = Uint8Array.from(new Uint8Array(bits));
  new Uint8Array(bits).fill(0);
  return out;
}

/** THE single place slot key bytes become an AES-GCM key. The locally-derived path and the
 *  received-over-the-wire path both land here, so the key that seals a blob and the key that opens it
 *  cannot drift apart — a drift would enrol a passkey that is listed, believed, and unopenable. */
async function importWrappingKey(wrappingKey: Uint8Array): Promise<CryptoKey> {
  if (wrappingKey.length !== WRAPPING_KEY_BYTES) {
    throw new Error(`A slot wrapping key must be exactly ${WRAPPING_KEY_BYTES} bytes`);
  }
  return crypto.subtle.importKey("raw", bytesToArrayBuffer(wrappingKey), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function deriveAesKey(prfOutput: ArrayBuffer, address: Address, credentialId: string): Promise<CryptoKey> {
  const bits = await deriveSlotWrappingKeyBits(prfOutput, address, credentialId);
  try {
    return await importWrappingKey(bits);
  } finally {
    bits.fill(0);
  }
}

async function sealUnder(key: CryptoKey, container: SecretContainer): Promise<EncryptedKeyBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  // Plaintext is the raw 32 key bytes. bytesToArrayBuffer copies, so `plaintext` is a transient we
  // own and wipe below — the caller's container.key is untouched (its lifetime is the caller's).
  const plaintext = bytesToArrayBuffer(serializeContainer(container));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bytesToArrayBuffer(iv) }, key, plaintext);
  new Uint8Array(plaintext).fill(0);
  return { version: BLOB_VERSION, iv, ciphertext: new Uint8Array(ciphertext) };
}

/** Seal K under a wrapping key RECEIVED OVER THE WIRE (passkey enrolment — see enrolment.ts). The key is
 *  already bound to its wallet and its access slot by the HKDF `info` the enroller used, so no address and
 *  no PRF are needed here: the holder never sees the enroller's PRF, and the enroller never sees K. */
export async function encryptKeyBlobWithWrappingKey(args: {
  container: SecretContainer;
  wrappingKey: Uint8Array;
}): Promise<EncryptedKeyBlob> {
  return sealUnder(await importWrappingKey(args.wrappingKey), args.container);
}

export async function encryptKeyBlob(args: {
  container: SecretContainer;
  /** Wallet EVM address — bound into the AES `info` for domain separation. NOT stored in the blob;
   *  the decrypter re-supplies it from the secondary handle. */
  address: Address;
  /** Credential id — its derived slot id binds the AES key per-credential. NOT stored in the blob;
   *  the decrypter re-supplies it from discover(). */
  credentialId: string;
  prfOutput: ArrayBuffer;
}): Promise<EncryptedKeyBlob> {
  const key = await deriveAesKey(args.prfOutput, args.address, args.credentialId);
  return sealUnder(key, args.container);
}

/** Decrypt a blob back to the SecretContainer. `address` and `credentialId` are not stored in the
 *  blob — the caller re-supplies them (address from the secondary handle, credentialId from
 *  discover()); they reproduce the exact AES `info`/slot binding used at encrypt time. A wrong
 *  address or credentialId derives a different AES key, so AES-GCM's auth tag fails and decrypt
 *  throws. */
export async function decryptKeyBlob(
  blob: EncryptedKeyBlob,
  prfOutput: ArrayBuffer,
  address: Address,
  credentialId: string,
): Promise<SecretContainer> {
  // Accept every version we can READ, not just the one we WRITE. This blob may be years old and is
  // on chain forever; refusing it because a newer format exists would lock the wallet out of itself.
  // (A future version whose CIPHER or layout differs must branch here — not reject.)
  if (!isSupportedBlobVersion(blob.version)) {
    throw new Error(
      `Unsupported access-slot blob version: ${(blob as { version: number }).version} ` +
        `(this build reads: ${SUPPORTED_BLOB_VERSIONS.join(", ")})`,
    );
  }
  const key = await deriveAesKey(prfOutput, address, credentialId);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesToArrayBuffer(blob.iv) },
    key,
    bytesToArrayBuffer(blob.ciphertext),
  );
  // deserializeContainer copies the bytes into a fresh container; wipe this decrypt output so the
  // key plaintext does not linger. The returned container.key is the sandbox's to clear after use.
  const container = deserializeContainer(new Uint8Array(plaintext));
  new Uint8Array(plaintext).fill(0);
  return container;
}

/** The canonical on-chain envelope: version(1) || iv(12) || ciphertext(48). */
export function serializeBlob(blob: EncryptedKeyBlob): Uint8Array {
  const out = new Uint8Array(BLOB_BYTES);
  out[0] = blob.version;
  out.set(blob.iv, 1);
  out.set(blob.ciphertext, 1 + IV_BYTES);
  return out;
}

/**
 * Read a blob of ANY supported version — not just the one we currently write. The version byte is
 * read FIRST and the length judged against it, because a future version may change the layout and
 * an old-but-valid blob must never be rejected for being the wrong size for the CURRENT format.
 */
export function deserializeBlob(bytes: Uint8Array): EncryptedKeyBlob {
  if (bytes.length === 0) {
    throw new Error("Access-slot blob is empty");
  }
  const version = bytes[0]!;
  if (!isSupportedBlobVersion(version)) {
    throw new Error(
      `Unsupported access-slot blob version: ${version} (this build reads: ${SUPPORTED_BLOB_VERSIONS.join(", ")})`,
    );
  }
  const expected = BLOB_BYTES_BY_VERSION[version];
  if (bytes.length !== expected) {
    throw new Error(`Access-slot blob v${version} must be exactly ${expected} bytes, got ${bytes.length}`);
  }
  return {
    version,
    iv: bytes.slice(1, 1 + IV_BYTES),
    ciphertext: bytes.slice(1 + IV_BYTES),
  };
}
