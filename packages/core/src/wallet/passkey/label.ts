import { bytesToHex, getAddress, hexToBytes, keccak256, type Address } from "viem";

// Friendly-nickname word lists. The label is display-only (never verified or stored anywhere), so a
// small deterministic set is fine — collisions are cosmetic. Chain-neutral by construction.
const NICK_ADJECTIVES = [
  "Amber",
  "Brave",
  "Calm",
  "Cobalt",
  "Crimson",
  "Dawn",
  "Ember",
  "Fern",
  "Golden",
  "Hazel",
  "Indigo",
  "Jade",
  "Lunar",
  "Mellow",
  "Noble",
  "Onyx",
  "Pearl",
  "Quartz",
  "Ruby",
  "Sage",
  "Teal",
  "Umber",
  "Velvet",
  "Wren",
] as const;
const NICK_NOUNS = [
  "Otter",
  "Falcon",
  "Cedar",
  "Lynx",
  "Heron",
  "Maple",
  "Bison",
  "Coral",
  "Finch",
  "Willow",
  "Marten",
  "Osprey",
  "Birch",
  "Sparrow",
  "Alder",
  "Raven",
  "Fox",
  "Crane",
  "Elm",
  "Badger",
  "Kestrel",
  "Aspen",
  "Marlin",
  "Robin",
] as const;

/** Picker label for a credential whose address we don't know yet (it derives from the PRF the
 *  ceremony hasn't returned yet). Cosmetic; collisions fine. Keyed off the random userHandle so two
 *  credentials created back to back get different nicknames. */
export function handleLabel(networkName: string, handle: Uint8Array): string {
  const h = hexToBytes(keccak256(handle));
  const adjective = NICK_ADJECTIVES[h[0] % NICK_ADJECTIVES.length];
  const noun = NICK_NOUNS[h[1] % NICK_NOUNS.length];
  return `${networkName} Wallet · ${adjective} ${noun}`;
}

// ---------------------------------------------------------------------------
// User-handle routing (D8 roster model).
//
// A credential's derived key (K = HKDF(PRF)) is that DEVICE's own signer address — it is only ever
// the WALLET's own address for the founding device. Every other device registered later has its own
// independent key, distinct from the wallet's Calibur contract address, and needs to know which
// wallet it signs for. WebAuthn's user.id travels with the credential for free (the authenticator
// returns it on every discover()), so it is the natural place to carry that one piece of non-secret
// routing metadata — the same mechanism the pre-D8 scheme used, repurposed: not "which credentials
// share a key" (that concept is gone), but "does this credential's own address equal the wallet, or
// does it act on behalf of a different one."
// ---------------------------------------------------------------------------

const KIND_SELF = 0x01;
const KIND_ROSTER = 0x02;

export type UserHandle = { kind: "self" } | { kind: "roster"; walletAddress: Address };

/** A founding device's user.id: [0x01][32 random bytes] = 33 bytes. Carries no address — this
 *  device's own derived address IS the wallet. The random bytes only prevent a same-rpId,
 *  same-device second `create()` from overwriting the first (WebAuthn keys a discoverable
 *  credential by (rpId, user.id)). */
export function encodeSelfHandle(): Uint8Array {
  const out = new Uint8Array(33);
  out[0] = KIND_SELF;
  out.set(crypto.getRandomValues(new Uint8Array(32)), 1);
  return out;
}

/** A roster device's user.id: [0x02][20-byte wallet address][8 random bytes] = 29 bytes. Records
 *  which wallet this device was enrolled to sign for — known upfront (the inviting device already
 *  has it), unlike the founding device's address which does not exist until its own PRF returns. */
export function encodeRosterHandle(walletAddress: Address): Uint8Array {
  const out = new Uint8Array(29);
  out[0] = KIND_ROSTER;
  out.set(hexToBytes(getAddress(walletAddress)), 1);
  out.set(crypto.getRandomValues(new Uint8Array(8)), 21);
  return out;
}

/** Read a credential's user.id. Consumed at login/discover to resolve which wallet it signs for. */
export function decodeUserHandle(bytes: Uint8Array): UserHandle {
  const kind = bytes[0];
  if (kind === KIND_SELF) {
    if (bytes.length !== 33) throw new Error("Self user handle is not 33 bytes");
    return { kind: "self" };
  }
  if (kind === KIND_ROSTER) {
    if (bytes.length !== 29) throw new Error("Roster user handle is not 29 bytes");
    return { kind: "roster", walletAddress: getAddress(bytesToHex(bytes.slice(1, 21))) };
  }
  throw new Error(`Passkey user handle has an unknown kind byte: ${kind}`);
}
