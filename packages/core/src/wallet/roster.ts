import type { Address, Hex } from "viem";
import { deriveSlotId } from "./passkey/label.js";

/** One access slot: its slot id, when it was enrolled (unix seconds), its metadata ciphertext, and whether
 *  it is the device asking. No name and no credential id — an access slot is distinguished by its enrollment
 *  date, and nothing that fingerprints the user is stored on chain to build this. */
export interface AccessSlotEntry {
  slotId: Hex;
  addedAt: number;
  /** Opaque per-slot ciphertext (the enrolling rp-id). Public — it lands on chain in this form, and
   *  reading it needs the wallet key, which this listing never holds. See roster-meta.ts. */
  encryptedMeta: Uint8Array;
  isThisDevice: boolean;
}

export interface RosterReader {
  getAccessSlotIds(address: Address): Promise<readonly Hex[]>;
  getAccessSlotAddedAt(address: Address, slotId: Hex): Promise<number>;
  getAccessSlotMeta(address: Address, slotId: Hex): Promise<Uint8Array>;
}

export async function listAccessSlots(args: {
  address: Address;
  reader: RosterReader;
  /** The credential this session authenticated with, if any — marks the current device. */
  thisCredentialId?: string;
}): Promise<AccessSlotEntry[]> {
  // The current device is identified by its slot id, computed from its own credential id — nothing
  // per-credential is stored on chain.
  const thisSlotId = args.thisCredentialId ? deriveSlotId(args.address, args.thisCredentialId) : null;
  const ids = await args.reader.getAccessSlotIds(args.address);
  const out: AccessSlotEntry[] = [];
  for (const slotId of ids) {
    out.push({
      slotId,
      addedAt: await args.reader.getAccessSlotAddedAt(args.address, slotId),
      encryptedMeta: await args.reader.getAccessSlotMeta(args.address, slotId),
      isThisDevice: slotId === thisSlotId,
    });
  }
  return out;
}
