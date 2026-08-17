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

/**
 * ROUND 1, holder → enroller: the INVITE. The holder speaks first, and the offer it carries — which
 * wallet, which anchor chain — travels in CLEARTEXT.
 *
 * Both fields are already public on chain — the wallet address is the account, and the anchor chain
 * is where its slots live — so sealing them bought nothing. They were sealed only because they used
 * to ride a message that happened to be sealed. What they DO need is integrity, which they get from
 * the SAS transcript (see `computeSas`): tamper with either and the six digits diverge.
 *
 * The holder speaks first because of what the enroller cannot do without this. A credential's user
 * handle is baked at creation and immutable, and it must name the wallet — so the enroller cannot
 * mint anything until it knows these two values.
 */
export interface PairInvite {
  v: 1;
  kind: "invite";
  /** The holder's ephemeral public key. */
  aPub: string;
  nonce: string;
  /** The wallet being enrolled into. Public; integrity comes from the SAS. */
  evm: string;
  /** The chain its access slot is written to. Public; integrity comes from the SAS. */
  anchorChainId: number;
}
export function buildInvite(
  eph: PairEphemeral,
  nonce: string,
  offer: { evm: string; anchorChainId: number },
): PairInvite {
  return {
    v: PAIRING_VERSION,
    kind: "invite",
    aPub: bytesToBase64Url(eph.publicKey),
    nonce,
    evm: offer.evm,
    anchorChainId: offer.anchorChainId,
  };
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
  /** True on the ENROLLER (the side acquiring access). Fixes transcript position, not send order. */
  iAmEnroller: boolean;
  nonce: string;
  /** The cleartext offer from round 1. Bound into the SAS so tampering with it is visible. */
  offer: { evm: string; anchorChainId: number };
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
  // Canonical transcript order: enroller(B) pubkey ‖ holder(A) pubkey ‖ nonce ‖ offer. Position is
  // by ROLE, not by who spoke first — the holder now sends round 1, and tying the order to send
  // order instead would have silently swapped the transcript and broken every SAS.
  const bPub = args.iAmEnroller ? args.myPublic : args.theirPublic;
  const aPub = args.iAmEnroller ? args.theirPublic : args.myPublic;
  const sas = await computeSas(bPub, aPub, args.nonce, args.offer);
  return { key, sas };
}

/**
 * 6 decimal digits over the WHOLE transcript: SHA-256(bPub ‖ aPub ‖ nonce ‖ evm ‖ anchorChainId).
 *
 * The offer is in here because it is no longer sealed. An attacker relaying both public keys
 * faithfully while rewriting `evm` would otherwise pass every check: the shared secrets match, the
 * digits match, and the enroller mints a credential whose immutable user handle names a wallet its
 * user never chose — a silent, permanent, confusing failure. Committing the offer to the digits makes
 * that tampering visible to the two humans comparing them.
 */
export async function computeSas(
  bPub: Uint8Array,
  aPub: Uint8Array,
  nonce: string,
  offer: { evm: string; anchorChainId: number },
): Promise<string> {
  // Lowercased: an EVM address is case-insensitive but checksums vary by source, and two sides that
  // disagree on case would show different digits for an identical, untampered ceremony.
  const ob = stringToBytes(`${offer.evm.toLowerCase()}|${offer.anchorChainId}`);
  const nb = stringToBytes(nonce);
  const transcript = new Uint8Array(bPub.length + aPub.length + nb.length + ob.length);
  transcript.set(bPub, 0);
  transcript.set(aPub, bPub.length);
  transcript.set(nb, bPub.length + aPub.length);
  transcript.set(ob, bPub.length + aPub.length + nb.length);
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
