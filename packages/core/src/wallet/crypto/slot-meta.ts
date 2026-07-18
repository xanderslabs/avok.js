import { hexToBytes, stringToBytes, type Hex } from "viem";
import { bytesToArrayBuffer } from "../encoding.js";
import { HKDF_SALT, SLOT_META_INFO } from "./derive-wallet.js";

export const SLOT_META_VERSION = 0 as const;

const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
/** Fixed plaintext: rpIdLen(1) || rpId || zero-pad. Constant so the ciphertext size leaks nothing.
 *  64 bytes covers realistic rp-ids (short domains); longer ones are rejected at encrypt time. */
const META_PLAINTEXT_BYTES = 64;
export const META_BYTES = 1 + IV_BYTES + META_PLAINTEXT_BYTES + GCM_TAG_BYTES; // version + iv + ct

/** Per-slot metadata key, derived from the WALLET KEY (not a PRF). See SLOT_META_INFO. */
async function deriveMetaKey(walletKey: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", bytesToArrayBuffer(walletKey), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: bytesToArrayBuffer(stringToBytes(HKDF_SALT)),
      info: bytesToArrayBuffer(stringToBytes(SLOT_META_INFO)),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt an access slot's metadata (currently the enrolling rp-id). Bound to its slot via slotId as the
 *  AES-GCM additionalData, so the ciphertext cannot be copied to another access slot. */
export async function encryptSlotMeta(walletKey: Uint8Array, slotId: Hex, rpId: string): Promise<Uint8Array> {
  const rpBytes = stringToBytes(rpId);
  if (rpBytes.length > META_PLAINTEXT_BYTES - 1) throw new Error("rp-id is too long for an access slot's metadata");
  const plaintext = new Uint8Array(META_PLAINTEXT_BYTES); // zero-filled tail = the pad
  plaintext[0] = rpBytes.length;
  plaintext.set(rpBytes, 1);

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveMetaKey(walletKey);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bytesToArrayBuffer(iv), additionalData: bytesToArrayBuffer(hexToBytes(slotId)) },
    key,
    bytesToArrayBuffer(plaintext),
  );
  plaintext.fill(0);

  const out = new Uint8Array(META_BYTES);
  out[0] = SLOT_META_VERSION;
  out.set(iv, 1);
  out.set(new Uint8Array(ct), 1 + IV_BYTES);
  return out;
}

export async function decryptSlotMeta(
  walletKey: Uint8Array,
  slotId: Hex,
  bytes: Uint8Array,
): Promise<{ rpId: string }> {
  if (bytes.length !== META_BYTES) throw new Error(`Access-slot metadata must be exactly ${META_BYTES} bytes`);
  if (bytes[0] !== SLOT_META_VERSION) throw new Error(`Unsupported access-slot-metadata version: ${bytes[0]}`);
  const key = await deriveMetaKey(walletKey);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytesToArrayBuffer(bytes.slice(1, 1 + IV_BYTES)),
        additionalData: bytesToArrayBuffer(hexToBytes(slotId)),
      },
      key,
      bytesToArrayBuffer(bytes.slice(1 + IV_BYTES)),
    ),
  );
  const rpLen = plaintext[0];
  const rpId = new TextDecoder().decode(plaintext.slice(1, 1 + rpLen));
  plaintext.fill(0);
  return { rpId };
}
