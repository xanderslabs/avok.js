/**
 * Shared-origin fresh-device recovery confirmation — the SECONDARY anchor-vault path.
 *
 * A primary IS the wallet: it derives K = HKDF(PRF) offline and reads nothing. A SECONDARY cannot
 * derive K; it wraps K under its own PRF and publishes that ciphertext to the anchor chain. The
 * shared-origin sign rail's fresh-device path therefore only touches the vault for a secondary — so this
 * test drives a genuine secondary end-to-end: a fresh device `discover()`s as the secondary,
 * resolves its ciphertext from the anchor vault, decrypts, and signs.
 *
 * The origin's shared-origin sign path is the single-gesture `withDiscoveredKeys` (auth-popup/mount.ts),
 * handed an anchorVault built from the reader's resolved anchor chain. This test exercises that exact
 * primitive against a populated anchor vault, proving the anchor read reconstructs a secondary's state
 * and produces a valid signature for the ORIGINAL wallet address.
 */
import { describe, expect, it } from "vitest";
import { verifyMessage } from "viem";
import {
  createWallet,
  addPasskey,
  deriveWalletKey,
  deriveSlotId,
  serializeBlob,
  withDiscoveredKeys,
} from "../../src/wallet/index.js";
import { FakePasskeyAdapter, FakeVaultReader } from "../wallet/fakes.js";

describe("shared-origin fresh-device recovery (origin sign bootstrap)", () => {
  it("reconstructs a SECONDARY from its on-chain access-slot blob on a fresh device, and signs", async () => {
    // 1. Create the PRIMARY — this is the identity. K = HKDF(PRF); it stores no blob.
    const passkey = new FakePasskeyAdapter();
    const { account } = await createWallet({ passkey, networkName: "Avok" });

    // 2. Enrol a REAL secondary: recover K from the primary credential, then wrap it under the new
    //    credential's own PRF — exactly how a second device is added. `addPasskey` produces the
    //    genuine ciphertext blob and marks the new credential's handle `kind: "secondary"`.
    const primaryId = (await passkey.discover()).credentialId;
    const key = await deriveWalletKey(await passkey.authenticate(primaryId));
    const { slot, blob } = await addPasskey({
      passkey,
      networkName: "Avok",
      container: { key },
      address: account.evm,
      solanaAddress: account.solana,
      anchorChainId: 10,
    });

    // 3. Publish that blob to the anchor vault under the secondary's slot id — what the access-slot write does
    //    on-chain. The vault is the ONLY place the secondary's key material lives.
    const vault = new FakeVaultReader();
    vault.set(account.evm, deriveSlotId(account.evm, slot.credentialId), serializeBlob(blob));

    // 4. Fresh device: a single `discover()` surfaces the secondary (its handle decodes to
    //    kind: "secondary"), the origin resolves its ciphertext from the anchor vault, decrypts under
    //    the discover() PRF, and signs. No local state is carried in — recovery is purely vault-driven.
    const signature = await withDiscoveredKeys({ passkey, vaultForChain: () => vault }, async ({ evm }, state) => {
      // 5. The invariant that makes Solana work: the recovered addresses are IDENTICAL to the
      //    primary's, because both credentials reach the same K and the Solana address IS the
      //    ed25519 public key of that K. A new key would be a different, unrecoverable wallet.
      expect(evm.address.toLowerCase()).toBe(account.evm.toLowerCase());
      expect(state.evmAddress).toBe(account.evm);
      expect(state.solanaAddress).toBe(account.solana);
      return evm.signMessage({ message: "recovered on a fresh device" });
    });

    // The recovered key produced a valid signature for the ORIGINAL wallet address.
    expect(await verifyMessage({ address: account.evm, message: "recovered on a fresh device", signature })).toBe(true);
  });
});
