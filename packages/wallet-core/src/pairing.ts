import { x25519 } from "@noble/curves/ed25519.js";
import { stringToBytes } from "viem";
import { bytesToBase64Url, base64UrlToBytes, bytesToArrayBuffer } from "./encoding.js";

/**
 * The channel a passkey is provisioned over: x25519 ECDH → an AES-GCM session key → a 6-digit SAS the
 * human compares on both screens.
 *
 * THE WALLET KEY NEVER TRAVELS ON IT. There is exactly ONE enrolment ceremony (enrolment.ts): the new
 * credential derives its own wrapping key from its own PRF and sends THAT; the side holding K seals it
 * under that key and writes the slot. An earlier design shipped K itself over this channel — that code
 * is gone, deliberately and permanently. If you are about to add a payload carrying key material here,
 * you are re-introducing the thing this was built to remove.
 */
const PAIRING_VERSION = 1 as const;

/** HKDF `info` prefix for the session key. The full info is `${PAIRING_INFO_PREFIX}|${nonce}`.
 *  Normative: the two sides may be two different IMPLEMENTATIONS (a passkey under an independent domain
 *  is provisioned over this exact ceremony), so both must reproduce it byte-for-byte. */
export const PAIRING_INFO_PREFIX = "passkey-access-vault/pairing-session/v0";

export interface PairEphemeral {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/** Fresh x25519 keypair for one pairing session. */
export function generateEphemeral(): PairEphemeral {
  const privateKey = x25519.utils.randomSecretKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/** 128-bit session nonce (base64url). */
export function randomNonce(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export interface PairRequest {
  v: 1;
  kind: "request";
  bPub: string;
  nonce: string;
}
/**
 * The ack also CARRIES THE OFFER: the wallet address and anchor chain, sealed under the session key.
 * The enrolling side needs both BEFORE it can mint its credential (they are baked into the passkey's
 * user handle at creation), and folding them in here keeps the ceremony at three codes — the same
 * count as the old K-shipping flow, so removing K from the wire costs the user no extra step.
 */
export interface PairAck {
  v: 1;
  kind: "ack";
  aPub: string;
  nonce: string;
  /** Sealed offer: AES-GCM(iv, {evm, anchorChainId}) under the session key. */
  iv: string;
  ct: string;
}

export function buildRequest(eph: PairEphemeral, nonce: string): PairRequest {
  return { v: PAIRING_VERSION, kind: "request", bPub: bytesToBase64Url(eph.publicKey), nonce };
}

/** Serialize a payload to base64url JSON (for QR rendering). Any versioned, kinded payload — the
 *  enrolment ceremony (enrolment.ts) rides the same envelope with its own kinds. */
export function encodePayload(p: { v: 1; kind: string }): string {
  return bytesToBase64Url(stringToBytes(JSON.stringify(p)));
}

/** Parse + validate a scanned payload; throws on version/kind mismatch. */
export function decodePayload<T extends { v: 1; kind: string }>(s: string, kind: T["kind"]): T {
  const p = JSON.parse(new TextDecoder().decode(base64UrlToBytes(s))) as T;
  if (p.v !== PAIRING_VERSION || p.kind !== kind) {
    throw new Error(`Invalid pairing payload: expected ${kind} v${PAIRING_VERSION}`);
  }
  return p;
}

/** ECDH → HKDF-SHA256 AES-GCM session key, plus the 6-digit SAS over the transcript. */
export async function deriveSession(args: {
  myPrivate: Uint8Array;
  myPublic: Uint8Array;
  theirPublic: Uint8Array;
  iAmInitiator: boolean; // B (new device) = initiator
  nonce: string;
}): Promise<{ key: CryptoKey; sas: string }> {
  const shared = x25519.getSharedSecret(args.myPrivate, args.theirPublic);
  const baseKey = await crypto.subtle.importKey("raw", bytesToArrayBuffer(shared), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      // Vendor-neutral, and that is load-bearing: passkey enrolment (enrolment.ts) runs this exact
      // handshake between TWO DIFFERENT DOMAINS, which may be two different implementations of the
      // standard. Both sides must derive the identical session key, so this string is part of the wire
      // protocol — a vendor's name here would make every other implementer recite it.
      info: bytesToArrayBuffer(stringToBytes(`${PAIRING_INFO_PREFIX}|${args.nonce}`)),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  // Canonical transcript order: initiator(B) pubkey ‖ responder(A) pubkey ‖ nonce.
  const bPub = args.iAmInitiator ? args.myPublic : args.theirPublic;
  const aPub = args.iAmInitiator ? args.theirPublic : args.myPublic;
  const sas = await computeSas(bPub, aPub, args.nonce);
  return { key, sas };
}

/** 6 decimal digits from SHA-256(bPub ‖ aPub ‖ nonce). */
export async function computeSas(bPub: Uint8Array, aPub: Uint8Array, nonce: string): Promise<string> {
  const nb = stringToBytes(nonce);
  const transcript = new Uint8Array(bPub.length + aPub.length + nb.length);
  transcript.set(bPub, 0);
  transcript.set(aPub, bPub.length);
  transcript.set(nb, bPub.length + aPub.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytesToArrayBuffer(transcript)));
  const n = ((digest[0] << 16) | (digest[1] << 8) | digest[2]) % 1_000_000;
  return n.toString().padStart(6, "0");
}

/** `buildAck` lives in enrolment.ts: the ack carries the sealed offer, which needs the session key.
 *
 *  K-TRANSPORT IS GONE. The key-sealing helpers and the grant payload were deleted along with the
 *  ceremony that shipped the wallet key to the new device. Nothing on this channel ever carries K
 *  again — the new credential sends its own wrapping key instead, and the holder does the sealing.
 *  test/pairing.test.ts enforces their absence by name. */
