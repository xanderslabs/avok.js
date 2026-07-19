import { vaultForChainFromRegistry, type VaultReader } from "@avokjs/core/wallet";
import { getChainProfile } from "@avokjs/contracts";

/**
 * A SECONDARY credential's access-slot blob lives on the chain recorded in its user-handle marker. Build a
 * read-only vault for THAT chain from the registry's RPC. A PRIMARY never calls this — it derives K
 * offline from its own PRF. An unknown marker chain fails loud rather than querying the wrong chain
 * and reporting a perfectly good wallet as "not found".
 *
 * Shared by both popups (`authorize` + `sign`) so they resolve blobs identically.
 */
export function vaultForChain(chainId: number): VaultReader {
  if (!getChainProfile(chainId)) {
    throw new Error(`No RPC for anchor chain ${chainId} — cannot reach this device's access-slot blob.`);
  }
  return vaultForChainFromRegistry(chainId);
}
