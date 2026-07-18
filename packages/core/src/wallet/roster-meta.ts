import { decryptSlotMeta, META_BYTES } from "./crypto/slot-meta.js";
import type { AccessSlotEntry } from "./roster.js";

/**
 * Reveal an access slot's enrolling rp-id — the ONE roster operation that needs the wallet key. Listing does
 * not, which is why it lives in its own file: the secret boundary is a file boundary, and the
 * roster-no-secrets guard scans roster.ts precisely because roster.ts must stay on the public side.
 *
 * Returns null for an empty or unreadable metadata (a passkey enrolled before metadata existed, a blob
 * written by another implementation, a corrupt one) so a settings screen can render the whole list
 * without one bad access slot throwing the page away.
 */
export async function readAccessSlotRpId(walletKey: Uint8Array, entry: AccessSlotEntry): Promise<string | null> {
  if (entry.encryptedMeta.length !== META_BYTES) return null;
  try {
    return (await decryptSlotMeta(walletKey, entry.slotId, entry.encryptedMeta)).rpId;
  } catch {
    return null;
  }
}
