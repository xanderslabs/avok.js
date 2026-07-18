import { describe, expect, it } from "vitest";
import {
  createWallet,
  addPasskey,
  deriveWalletKey,
  deriveSlotId,
  serializeBlob,
  type VaultReader,
} from "@avokjs/core/wallet";
import { OrphanedCredentialError, SlotUnreachableError, materializeWalletState } from "../src/sign/wallet-state.js";
// FakePasskeyAdapter and FakeVaultReader live in wallet-core test helpers.
import { FakePasskeyAdapter, FakeVaultReader } from "../../core/test/wallet/fakes.js";

describe("materializeWalletState", () => {
  it("reconstructs a PRIMARY offline with NO vault read", async () => {
    // The bug this whole plan exists to fix: a primary IS the wallet — K = HKDF(PRF) is derived
    // offline, and NOTHING is read from the access-slot chain. A vault touch on this path would be the
    // "your wallet is gone when the chain was merely unreachable" failure class. Inject a vault that
    // explodes on any read: the primary path must never reach it.
    const passkey = new FakePasskeyAdapter();
    const { account } = await createWallet({ passkey, networkName: "Avok" });

    let reads = 0;
    const explodingVault: VaultReader = {
      async getAccessSlot() {
        reads += 1;
        throw new Error("primary path must not read the access vault");
      },
    };

    const state = await materializeWalletState({ passkey, vaultReader: explodingVault });

    // A primary reconstructs both rails from K, holds a single slot, and stores no blob.
    expect(state.evmAddress).toBe(account.evm);
    expect(state.solanaAddress).toBe(account.solana);
    expect(state.slots).toHaveLength(1);
    expect(state.blobs).toHaveLength(0);
    // The regression guard: zero vault reads on the primary path.
    expect(reads).toBe(0);
  });

  it("reconstructs a SECONDARY from its on-chain access-slot blob", async () => {
    const passkey = new FakePasskeyAdapter();
    const { account } = await createWallet({ passkey, networkName: "Avok" });

    // Recover the wallet key K from the primary credential, then enrol a SECOND credential that
    // wraps K under its own PRF — exactly how a real second device is added. discover() now surfaces
    // this secondary (most-recently created), and its blob is what lives on the anchor chain.
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

    const vault = new FakeVaultReader();
    vault.set(account.evm, deriveSlotId(account.evm, slot.credentialId), serializeBlob(blob));

    const state = await materializeWalletState({ passkey, vaultReader: vault });

    expect(state.evmAddress).toBe(account.evm);
    expect(state.solanaAddress).toBe(account.solana);
    expect(state.slots).toHaveLength(1);
    expect(state.blobs).toHaveLength(1);
    expect(state.blobs[0].credentialId).toBe(slot.credentialId);
  });

  it("throws an ORPHAN error when a SECONDARY's vault answers and has nothing — never 'no wallet', never 'retry'", async () => {
    // This test used to expect SlotUnreachableError ("check your connection and retry") for a chain that
    // ANSWERED and held no access slot. That conflated two different facts and left the user retrying a thing
    // that can never succeed. An empty-but-readable vault means the credential was never finished
    // enrolling: an orphan, repairable only through a surviving passkey. The message must claim neither
    // that the wallet is gone nor that retrying will help.
    const passkey = new FakePasskeyAdapter();
    const { account } = await createWallet({ passkey, networkName: "Avok" });
    const primaryId = (await passkey.discover()).credentialId;
    const key = await deriveWalletKey(await passkey.authenticate(primaryId));
    await addPasskey({
      passkey,
      networkName: "Avok",
      container: { key },
      address: account.evm,
      solanaAddress: account.solana,
      anchorChainId: 10,
    });

    // Empty but READABLE vault → resolveBlob returns null → the slot is positively absent.
    const emptyVault = new FakeVaultReader();
    const err = await materializeWalletState({ passkey, vaultReader: emptyVault }).catch((e) => e);
    expect(err).toBeInstanceOf(OrphanedCredentialError);
    expect(err.message).not.toMatch(/no wallet|does not exist|not found/i);
    expect(err.message).not.toMatch(/try again|retry|connection/i);
  });

  it("throws SlotUnreachableError when the vault read itself fails", async () => {
    const passkey = new FakePasskeyAdapter();
    const { account } = await createWallet({ passkey, networkName: "Avok" });
    const primaryId = (await passkey.discover()).credentialId;
    const key = await deriveWalletKey(await passkey.authenticate(primaryId));
    await addPasskey({
      passkey,
      networkName: "Avok",
      container: { key },
      address: account.evm,
      solanaAddress: account.solana,
      anchorChainId: 10,
    });

    const failingVault: VaultReader = {
      async getAccessSlot() {
        throw new Error("RPC down");
      },
    };
    await expect(materializeWalletState({ passkey, vaultReader: failingVault })).rejects.toBeInstanceOf(
      SlotUnreachableError,
    );
  });
});
