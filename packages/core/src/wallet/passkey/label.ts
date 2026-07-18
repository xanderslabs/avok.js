import { bytesToHex, getAddress, hexToBytes, keccak256, type Address, type Hex } from "viem";
import { base64UrlToBytes } from "../encoding.js";

// Friendly-nickname word lists. The label is display-only (never verified or stored in the blob),
// so a small deterministic set is fine — collisions are cosmetic. Chain-neutral by construction.
const NICK_ADJECTIVES = [
  "Amber", "Brave", "Calm", "Cobalt", "Crimson", "Dawn", "Ember", "Fern",
  "Golden", "Hazel", "Indigo", "Jade", "Lunar", "Mellow", "Noble", "Onyx",
  "Pearl", "Quartz", "Ruby", "Sage", "Teal", "Umber", "Velvet", "Wren",
] as const;
const NICK_NOUNS = [
  "Otter", "Falcon", "Cedar", "Lynx", "Heron", "Maple", "Bison", "Coral",
  "Finch", "Willow", "Marten", "Osprey", "Birch", "Sparrow", "Alder", "Raven",
  "Fox", "Crane", "Elm", "Badger", "Kestrel", "Aspen", "Marlin", "Robin",
] as const;

/**
 * On-chain access-slot id: keccak256(address ‖ credentialId). Never stored in the blob.
 *
 * THE ADDRESS IS NOT DECORATION. A credential id is transmitted to the relying party on every
 * WebAuthn assertion, so every RP a user has ever authenticated to holds it. Were the slot id
 * keccak256(credentialId) alone, any of them could compute it and find the user's wallet on chain.
 * Binding the address makes the slot id uncomputable without the address — which is the very thing
 * an RP is trying to learn. The address is canonicalised (getAddress) so a checksummed and a
 * lowercased caller cannot land on different slots for the same credential.
 */
export function deriveSlotId(address: Address, credentialId: string): Hex {
  const addressBytes = hexToBytes(getAddress(address)); // 20 bytes, canonicalised
  const credBytes = base64UrlToBytes(credentialId);
  const buf = new Uint8Array(addressBytes.length + credBytes.length);
  buf.set(addressBytes, 0);
  buf.set(credBytes, addressBytes.length);
  return keccak256(buf);
}

const KIND_FOUNDING = 0x01;
const KIND_ACCESS = 0x02;

/** What a credential's user.id tells us at login, before any key material is derived. */
export type UserHandle =
  | { kind: "primary" }
  | { kind: "secondary"; evm: Address; anchorChain: number };

/**
 * A primary's user.id: [0x01][32 random bytes] = 33 bytes.
 *
 * It CANNOT hold the wallet addresses: user.id is part of the create() request, while the PRF
 * output — from which the addresses derive — only arrives in the response.
 *
 * The 32 random bytes are not padding. WebAuthn keys a discoverable credential by
 * (rpId, user.id), and an authenticator overwrites an existing credential for the same pair. A
 * constant primary handle would mean the second wallet a user creates on a provider silently
 * destroys the first.
 */
export function encodeFoundingHandle(): Uint8Array {
  const out = new Uint8Array(33);
  out[0] = KIND_FOUNDING;
  out.set(crypto.getRandomValues(new Uint8Array(32)), 1);
  return out;
}

/** A secondary's user.id: [0x02][20-byte EVM][8-byte BE anchor chainId] = 29 bytes
 *  (≤ WebAuthn's 64-byte user.id limit).
 *
 *  The handle records the EVM address plus the anchor chain its access-slot blob is written to, so a
 *  reader — even a DIFFERENT app sharing the rpId with a different configured anchor — resolves the
 *  ciphertext from the chain that actually holds it, not from its own app anchor. The Solana address
 *  is NOT carried here: every resolution path finds the blob via evm + anchorChain + credentialId,
 *  and the blob itself carries `solanaAddress`. The anchor is a WRITE-side default (where THIS app
 *  stores a NEW secondary); reads follow this marker. Always an EVM numeric chainId —
 *  `resolveAnchorChain` rejects non-EVM, so a Solana cluster can never be an anchor. */
export function encodeAccessHandle(evm: Address, anchorChainId: number): Uint8Array {
  if (!Number.isInteger(anchorChainId) || anchorChainId < 0) {
    throw new Error("Anchor chainId must be a non-negative integer");
  }
  const out = new Uint8Array(29);
  out[0] = KIND_ACCESS;
  out.set(hexToBytes(getAddress(evm)), 1);
  // 8-byte big-endian chainId at offset 21. Width is 8 bytes to hold any registry chainId with room
  // to spare (Number stays exact well below 2^53; registry ids are far smaller).
  new DataView(out.buffer).setBigUint64(21, BigInt(anchorChainId), false);
  return out;
}

/** Read a credential's user.id. Consumed by discover() at login to pick the derive-or-decrypt path. */
export function decodeUserHandle(bytes: Uint8Array): UserHandle {
  const kind = bytes[0];
  if (kind === KIND_FOUNDING) {
    if (bytes.length !== 33) throw new Error("Primary user handle is not 33 bytes");
    return { kind: "primary" };
  }
  if (kind === KIND_ACCESS) {
    if (bytes.length !== 29) throw new Error("Secondary user handle is not 29 bytes");
    // Read the trailing 8-byte big-endian anchor chainId via a fresh DataView over exactly those
    // bytes — `bytes` may be a subarray view (non-zero byteOffset), so index off its own view.
    const anchorChain = Number(new DataView(bytes.buffer, bytes.byteOffset + 21, 8).getBigUint64(0, false));
    return {
      kind: "secondary",
      evm: getAddress(bytesToHex(bytes.slice(1, 21))),
      anchorChain,
    };
  }
  throw new Error(`Passkey user handle has an unknown kind byte: ${kind}`);
}

/** Picker label for a credential whose address we don't know yet (a primary). Cosmetic; collisions fine. */
export function handleLabel(networkName: string, handle: Uint8Array): string {
  const h = hexToBytes(keccak256(handle));
  const adjective = NICK_ADJECTIVES[h[0] % NICK_ADJECTIVES.length];
  const noun = NICK_NOUNS[h[1] % NICK_NOUNS.length];
  return `${networkName} Wallet · ${adjective} ${noun}`;
}
