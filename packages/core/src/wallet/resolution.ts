import type { Address } from "viem";
import { deserializeBlob, type EncryptedKeyBlob } from "./crypto/blob.js";
import { deriveSlotId } from "./passkey/label.js";
import type { VaultReader } from "./vault.js";

export type BlobSource = "anchor" | "tx-chain";

export interface ResolveBlobResult {
  blob: EncryptedKeyBlob;
  source: BlobSource;
}

function parse(bytes: Uint8Array | null): EncryptedKeyBlob | null {
  if (!bytes) return null;
  try {
    return deserializeBlob(bytes);
  } catch {
    return null;
  }
}

/**
 * Find a SECONDARY credential's encrypted blob: anchor chain → tx target chain.
 *
 * A primary never calls this — it derives K from its own PRF and stores nothing. There is no
 * largeBlob tier: iCloud Keychain does not implement the extension (measured), so it could never
 * be a universal mechanism.
 */
export async function resolveBlob(args: {
  address: Address;
  credentialId: string;
  anchorVault: VaultReader;
  txChainVault?: VaultReader;
}): Promise<ResolveBlobResult | null> {
  const slotId = deriveSlotId(args.address, args.credentialId);

  const fromAnchor = parse(await args.anchorVault.getAccessSlot(args.address, slotId));
  if (fromAnchor) return { blob: fromAnchor, source: "anchor" };

  if (args.txChainVault) {
    const fromTx = parse(await args.txChainVault.getAccessSlot(args.address, slotId));
    if (fromTx) return { blob: fromTx, source: "tx-chain" };
  }

  return null;
}
