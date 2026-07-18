import { stringToBytes, type Address, type Hex } from "viem";
import { bytesToBase64Url, base64UrlToBytes, bytesToArrayBuffer } from "./encoding.js";
import type { SecretContainer } from "./crypto/container.js";
import {
  deriveSlotWrappingKeyBits,
  encryptKeyBlobWithWrappingKey,
  WRAPPING_KEY_BYTES,
  type EncryptedKeyBlob,
} from "./crypto/blob.js";
import { encryptSlotMeta } from "./crypto/slot-meta.js";
import { deriveSlotId, encodeAccessHandle, handleLabel } from "./passkey/label.js";
import type { PasskeyAdapter } from "./passkey/adapter.js";
import type { PairEphemeral, PairAck } from "./pairing.js";

/**
 * PASSKEY ENROLMENT — the ONE ceremony that provisions an access slot, and the only one there is.
 *
 * It does not matter whether the new credential lives on your own second device or under a completely
 * independent domain: the passkey that comes out is byte-identical (same slot id, same blob, same
 * recovery path), so there is one rail and one ceremony. "Which domain enrolled this passkey" is a
 * question the roster answers (roster.ts), not a different kind of passkey.
 *
 * HOW IT WORKS, and why K never moves: an access slot's blob is encrypted under HKDF(prf, address|slotId), and
 * BOTH of those `info` inputs are PUBLIC. So the enrolling side can derive that wrapping key (`W`)
 * itself, from its own PRF, and send W — instead of being handed the wallet key. The side that already
 * holds K seals K under W and pays for the write. The enrolling side needs NO chain access to enrol:
 * no RPC, no gas, no paymaster, no delegation. It runs a ceremony and passes ~64 bytes.
 *
 * W IS NOT prf, AND IT IS NOT K. It is a one-way HKDF child of prf, scoped by `info` to exactly one
 * (wallet, passkey) pair. Leaking prf would compromise every access slot that credential will ever have; leaking
 * W compromises this one access slot on this one wallet. It is still as powerful as K FOR THAT WALLET (W plus
 * the public blob yields K), so it travels only sealed under the SAS-confirmed session key. There is no
 * plaintext path for W, ever.
 *
 * WHAT THIS DOES NOT BUY: the enrolled credential holds its prf — that is precisely HOW it recovers —
 * and its slot is public on chain. So it can decrypt its way to K whenever it likes, not only during a
 * genuine recovery. ANY PASSKEY THAT CAN RECOVER THE WALLET CAN OBTAIN THE KEY. Enrolling a passkey is a
 * grant, deferred; no copy may claim otherwise.
 */
const ENROLMENT_VERSION = 1 as const;

/** What the holder tells the enroller: the wallet, and the chain its slot goes on. The enroller needs
 *  both BEFORE it can mint a credential (they are baked into the passkey's user handle at creation),
 *  which is why this rides the ACK — folding it there keeps the ceremony at three codes. */
export interface AccessSlotOffer { evm: Address; anchorChainId: number }

/** What the enroller sends back: its credential, its domain (for the roster), and its wrapping key. */
export interface AccessSlotWrap { v: 1; kind: "wrap"; iv: string; ct: string }

/** The payload kind is the AES-GCM additionalData, so an ack cannot be replayed as a wrap. */
async function seal(key: CryptoKey, kind: "ack" | "wrap", body: unknown): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bytesToArrayBuffer(iv), additionalData: bytesToArrayBuffer(stringToBytes(kind)) },
    key,
    bytesToArrayBuffer(stringToBytes(JSON.stringify(body))),
  );
  return { iv: bytesToBase64Url(iv), ct: bytesToBase64Url(new Uint8Array(ct)) };
}

async function open<T>(key: CryptoKey, kind: "ack" | "wrap", p: { iv: string; ct: string }): Promise<T> {
  const pt = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytesToArrayBuffer(base64UrlToBytes(p.iv)),
      additionalData: bytesToArrayBuffer(stringToBytes(kind)),
    },
    key,
    bytesToArrayBuffer(base64UrlToBytes(p.ct)),
  );
  const body = JSON.parse(new TextDecoder().decode(pt)) as T;
  new Uint8Array(pt).fill(0);
  return body;
}

/** Holder → enroller (round 2). The ack carries the session's public key AND the sealed offer. The
 *  offer is sealed rather than sent in the clear: a QR code is a thing people point cameras at. */
export async function buildAck(
  eph: PairEphemeral,
  nonce: string,
  key: CryptoKey,
  offer: AccessSlotOffer,
): Promise<PairAck> {
  return {
    v: ENROLMENT_VERSION,
    kind: "ack",
    aPub: bytesToBase64Url(eph.publicKey),
    nonce,
    ...(await seal(key, "ack", offer)),
  };
}

export async function openAck(key: CryptoKey, ack: PairAck): Promise<AccessSlotOffer> {
  return open<AccessSlotOffer>(key, "ack", ack);
}

/**
 * Enroller side (round 3, part one). Mint the credential under THIS origin, derive W from its PRF.
 *
 * K is never requested and never received — that is the point of the ceremony. The PRF is NOT wiped:
 * a registration's prfOutput belongs to the ADAPTER (an adapter may hand back a buffer it still owns,
 * and zeroing it would zero the credential — a passkey that enrols and can never be opened). Only the
 * single-use PRF from authenticate()/discover() is wiped. See test/secret-hygiene.test.ts.
 */
export async function createPasskeyCredential(args: {
  passkey: PasskeyAdapter;
  networkName: string;
  evm: Address;
  anchorChainId: number;
}): Promise<{ credentialId: string; rpId: string; wrappingKey: Uint8Array }> {
  const userHandle = encodeAccessHandle(args.evm, args.anchorChainId);
  const reg = await args.passkey.create(handleLabel(args.networkName, userHandle), userHandle);
  const wrappingKey = await deriveSlotWrappingKeyBits(reg.prfOutput, args.evm, reg.credentialId);
  return { credentialId: reg.credentialId, rpId: reg.rpId, wrappingKey };
}

/**
 * REPAIR. Derive the wrapping key for a credential that ALREADY EXISTS — one whose slot write never
 * landed (an orphan), so the passkey is real and reaches nothing. This is createPasskeyCredential with an
 * authenticate() where the create() was, and it reproduces the SAME W (the derivation binds only the
 * public address and slot id), so the repaired slot opens under that credential. A repair that
 * produced a different W would be the original bug with extra steps.
 *
 * This PRF comes from authenticate() and IS single-use — wipe it.
 */
export async function repairPasskeyCredential(args: {
  passkey: PasskeyAdapter;
  credentialId: string;
  rpId: string;
  evm: Address;
}): Promise<{ credentialId: string; rpId: string; wrappingKey: Uint8Array }> {
  const prfOutput = await args.passkey.authenticate(args.credentialId);
  try {
    const wrappingKey = await deriveSlotWrappingKeyBits(prfOutput, args.evm, args.credentialId);
    return { credentialId: args.credentialId, rpId: args.rpId, wrappingKey };
  } finally {
    new Uint8Array(prfOutput).fill(0);
  }
}

/** Enroller → holder (round 3): the credential id, this origin's rp-id (for the roster), and W. */
export async function sealWrap(
  key: CryptoKey,
  w: { credentialId: string; rpId: string; wrappingKey: Uint8Array },
): Promise<AccessSlotWrap> {
  const body = { credentialId: w.credentialId, rpId: w.rpId, wrappingKey: bytesToBase64Url(w.wrappingKey) };
  return { v: ENROLMENT_VERSION, kind: "wrap", ...(await seal(key, "wrap", body)) };
}

export async function openWrap(
  key: CryptoKey,
  p: AccessSlotWrap,
): Promise<{ credentialId: string; rpId: string; wrappingKey: Uint8Array }> {
  const body = await open<{ credentialId: string; rpId: string; wrappingKey: string }>(key, "wrap", p);
  const wrappingKey = base64UrlToBytes(body.wrappingKey);
  if (wrappingKey.length !== WRAPPING_KEY_BYTES) throw new Error("Enrolment wrap carries a malformed wrapping key");
  return { credentialId: body.credentialId, rpId: body.rpId, wrappingKey };
}

/** Holder side. Seal K under the received W and produce the access slot's roster metadata.
 *
 *  The slot id is derived HERE from the credential id — a slotId off the wire is never trusted, so a
 *  hostile enroller cannot aim the write at an access slot it did not create. W is wiped once the blob is
 *  sealed: it has done its one job, and it is as powerful as K for this wallet. */
export async function sealAccessSlot(args: {
  container: SecretContainer;
  evm: Address;
  credentialId: string;
  rpId: string;
  wrappingKey: Uint8Array;
}): Promise<{ slotId: Hex; blob: EncryptedKeyBlob; encryptedMeta: Uint8Array }> {
  const slotId = deriveSlotId(args.evm, args.credentialId);
  const blob = await encryptKeyBlobWithWrappingKey({ container: args.container, wrappingKey: args.wrappingKey });
  const encryptedMeta = await encryptSlotMeta(args.container.key, slotId, args.rpId);
  args.wrappingKey.fill(0);
  return { slotId, blob, encryptedMeta };
}
