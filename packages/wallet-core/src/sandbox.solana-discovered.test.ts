// packages/wallet-core/src/sandbox.solana-discovered.test.ts
import { describe, it, expect, vi } from "vitest";
import type { Address, Hex } from "viem";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { withDiscoveredSolanaKey } from "./sandbox.js";
import { makeContainerBlob } from "./test-helpers/blob-fixture.js";
import { deriveSlotId, encodeAccessHandle } from "./passkey/label.js";
import type { VaultReader } from "./vault.js";

/** Minimal anchor vault holding one blob at (address, slotId). */
function anchorVaultWith(address: string, slotId: Hex, bytes: Uint8Array): VaultReader {
  return {
    async getAccessSlot(a: Address, s: Hex) {
      return a.toLowerCase() === address.toLowerCase() && s.toLowerCase() === slotId.toLowerCase() ? bytes : null;
    },
  };
}

// The discovered credential is a SECONDARY: its handle carries the wallet addresses, and its blob
// is resolved from the on-chain (anchor) vault, then decrypted under the discover() PRF.
describe("withDiscoveredSolanaKey", () => {
  it("does one discover() gesture and signs with the in-sandbox ed25519 key", async () => {
    const fx = await makeContainerBlob();
    const discover = vi.fn().mockResolvedValue({
      credentialId: fx.credentialId,
      prfOutput: fx.prfOutput,
      userHandle: encodeAccessHandle(fx.evmAddress as Address, 10),
    });
    const passkey = { discover } as never;
    const anchorVault = anchorVaultWith(fx.evmAddress, deriveSlotId(fx.evmAddress as Address, fx.credentialId), fx.bytes);

    const msg = new Uint8Array([1, 2, 3, 4]);
    const { signature, address } = await withDiscoveredSolanaKey({ passkey, vaultForChain: () => anchorVault }, async (signer) => ({
      signature: await signer.sign(msg), address: signer.address,
    }));

    expect(discover).toHaveBeenCalledTimes(1);
    expect(address).toBe(fx.solanaAddress);
    expect(ed25519.verify(signature, msg, base58.decode(fx.solanaAddress))).toBe(true);
  });

  it("rejects a blob whose handle claims a different wallet (the address is bound into the AES key)", async () => {
    // The blob no longer stores its addresses — the EVM address comes from the handle and is bound
    // into the AES `info`. Present the blob under a handle claiming a DIFFERENT wallet address: the
    // derived AES key differs, AES-GCM's auth tag fails, and decrypt throws. This is the integrity
    // guard that replaced the old "stored solanaAddress was corrupted" check — a mismatched handle
    // can never unlock the blob, so a wrong wallet can never be signed for.
    const fx = await makeContainerBlob();
    const wrongAddress = "0x000000000000000000000000000000000000dEaD" as Address;
    const discover = vi.fn().mockResolvedValue({
      credentialId: fx.credentialId,
      prfOutput: fx.prfOutput,
      userHandle: encodeAccessHandle(wrongAddress, 10),
    });
    const passkey = { discover } as never;
    // The vault is keyed by the wrong address (matching the handle) so resolution SUCCEEDS and the
    // failure is the crypto binding, not a not-found.
    const anchorVault = anchorVaultWith(wrongAddress, deriveSlotId(wrongAddress, fx.credentialId), fx.bytes);

    await expect(withDiscoveredSolanaKey({ passkey, vaultForChain: () => anchorVault }, async () => 0))
      .rejects.toThrow();
  });
});
