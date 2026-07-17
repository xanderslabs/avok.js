import { describe, expect, test } from "vitest";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addPasskey, createWallet, exportWallet, reconstructWalletState } from "../src/wallet.js";
import { FakePasskeyAdapter } from "./fakes.js";

describe("wallet lifecycle", () => {
  test("addPasskey re-encrypts the EXISTING key so a secondary recovers the same wallet", async () => {
    const a = new FakePasskeyAdapter();
    const b = new FakePasskeyAdapter();
    const { account, state } = await createWallet({ passkey: a, networkName: "Qudi" });
    // The live primary hands its container (K = the EVM key) to the enrolment; a secondary wraps it.
    const primary = await exportWallet({ state, passkey: a, confirmExport: true });
    const { slot, blob } = await addPasskey({
      passkey: b, networkName: "Qudi", container: { key: hexToBytes(primary.evm) },
      address: account.evm, solanaAddress: account.solana, anchorChainId: 10,
    });
    // Device B can now export the same wallet — both credentials recover identical keys.
    const bState = { evmAddress: account.evm, solanaAddress: account.solana, slots: [slot], blobs: [{ credentialId: slot.credentialId, blob }] };
    const exported = await exportWallet({ state: bState, passkey: b, credentialId: slot.credentialId, confirmExport: true });
    expect(exported.evm).toBe(primary.evm);
    expect(exported.solana).toBe(primary.solana);
  });

  test("export requires confirmExport:true; passkeys keep working (copy not move)", async () => {
    const pk = new FakePasskeyAdapter();
    const { state } = await createWallet({ passkey: pk, networkName: "Qudi" });
    // @ts-expect-error confirmExport must be the literal true
    await expect(exportWallet({ state, passkey: pk, confirmExport: false })).rejects.toThrow();
    const exported = await exportWallet({ state, passkey: pk, confirmExport: true });
    expect(exported.evm).toMatch(/^0x[0-9a-f]{64}$/);
    expect(privateKeyToAccount(exported.evm).address).toBe(state.evmAddress); // EVM anchor preserved
  });

  // The removePasskey test was DELETED with the verb. Pruning a slot was never revocation: a paired
  // device decrypted K and keeps it forever, so removing its blob takes nothing away from it. See
  // public-api.test.ts — nothing may imply otherwise.

  test("reconstructWalletState decrypts+derives a secondary's addresses, and rejects a blob whose handle claims a different wallet", async () => {
    // A primary stores no blob, so enrol a secondary to obtain a coherent on-chain blob. The blob no
    // longer carries addresses — reconstruct DECRYPTS it (under this credential's PRF) and DERIVES the
    // addresses from K, re-supplying what the blob dropped (address from the handle, credentialId).
    const pkA = new FakePasskeyAdapter();
    const a = await createWallet({ passkey: pkA, networkName: "Qudi" });
    const keyA = (await exportWallet({ state: a.state, passkey: pkA, confirmExport: true })).evm;
    const pkSecA = new FakePasskeyAdapter();
    const secA = await addPasskey({ passkey: pkSecA, networkName: "Qudi", container: { key: hexToBytes(keyA) }, address: a.account.evm, solanaAddress: a.account.solana, anchorChainId: 10 });

    // Correct handle (a.account.evm) + this secondary's PRF → the derived addresses match the wallet.
    const rebuilt = await reconstructWalletState({
      blob: secA.blob,
      address: a.account.evm,
      credentialId: secA.slot.credentialId,
      rpId: "Qudi",
      prfOutput: await pkSecA.authenticate(secA.slot.credentialId),
    });
    expect(rebuilt.evmAddress).toBe(a.account.evm);
    expect(rebuilt.solanaAddress).toBe(a.account.solana);
    expect(rebuilt.blobs).toEqual([{ credentialId: secA.slot.credentialId, blob: secA.blob }]);

    // A handle claiming a DIFFERENT wallet address cannot even decrypt the blob (the address is bound
    // into the AES key), so it is rejected — never silently trusted.
    const wrong = "0x000000000000000000000000000000000000dEaD" as const;
    await expect(reconstructWalletState({
      blob: secA.blob,
      address: wrong,
      credentialId: secA.slot.credentialId,
      rpId: "Qudi",
      prfOutput: await pkSecA.authenticate(secA.slot.credentialId),
    })).rejects.toThrow();
  });
});
