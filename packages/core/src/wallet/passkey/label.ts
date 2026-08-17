import { hexToBytes, keccak256 } from "viem";

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
