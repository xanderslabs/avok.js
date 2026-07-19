import { describe, it, expect, vi } from "vitest";
import { createWallet } from "../../src/wallet/wallet.js";
import { decodeUserHandle } from "../../src/wallet/passkey/label.js";
import { NoPrfError } from "../../src/wallet/passkey/adapter.js";
import type { PasskeyAdapter } from "../../src/wallet/passkey/adapter.js";

/** A fake authenticator with a fixed PRF, so "same passkey ⇒ same wallet" is testable. */
const fakePasskey = (prfFill: number): PasskeyAdapter & { lastHandle?: Uint8Array } => {
  const self = {
    lastHandle: undefined as Uint8Array | undefined,
    async create(_label: string, userHandle: Uint8Array) {
      self.lastHandle = userHandle;
      return {
        credentialId: "Y3JlZC0x",
        prfOutput: new Uint8Array(32).fill(prfFill).buffer,
        transports: ["internal"],
        rpId: "avok.test",
        prf: { extension: "prf", saltVersion: "v0" } as const,
        platform: { authenticatorAttachment: "platform" } as const,
      };
    },
    async authenticate() {
      return new Uint8Array(32).fill(prfFill).buffer;
    },
    async discover() {
      return { credentialId: "Y3JlZC0x", prfOutput: new Uint8Array(32).fill(prfFill).buffer, userHandle: self.lastHandle! };
    },
  };
  return self as unknown as PasskeyAdapter & { lastHandle?: Uint8Array };
};

describe("createWallet (primary, PRF-derived)", () => {
  it("stores no blob — the passkey IS the wallet", async () => {
    // The bug this design exists to kill: a fresh wallet used to live only in memory, so logout
    // destroyed it. Now there is nothing to store and nothing to lose.
    const { state } = await createWallet({ passkey: fakePasskey(3), networkName: "Avok" });
    expect(state.blobs).toEqual([]);
  });

  it("state is coherent and carries no tx artifacts", async () => {
    // Ported from the deleted wallet.test.ts "create is lazy" test — the non-largeBlob invariants:
    // the state's addresses match the returned account, there is exactly one slot, and nothing in
    // the serialized state resembles an authorization/intent/signature (create touches no chain).
    const { account, state } = await createWallet({ passkey: fakePasskey(3), networkName: "Avok" });
    expect(state.evmAddress).toBe(account.evm);
    expect(state.solanaAddress).toBe(account.solana);
    expect(state.slots).toHaveLength(1);
    expect(JSON.stringify(state)).not.toMatch(/authorization|intent|signature/i);
  });

  it("registers itself as a primary in the user handle", async () => {
    const passkey = fakePasskey(3);
    await createWallet({ passkey, networkName: "Avok" });
    expect(decodeUserHandle(passkey.lastHandle!)).toEqual({ kind: "primary" });
  });

  it("the same PRF output always yields the same addresses", async () => {
    const a = await createWallet({ passkey: fakePasskey(5), networkName: "Avok" });
    const b = await createWallet({ passkey: fakePasskey(5), networkName: "Avok" });
    expect(b.account.evm).toBe(a.account.evm);
    expect(b.account.solana).toBe(a.account.solana);
  });

  it("a different PRF output yields a different wallet", async () => {
    const a = await createWallet({ passkey: fakePasskey(5), networkName: "Avok" });
    const b = await createWallet({ passkey: fakePasskey(6), networkName: "Avok" });
    expect(b.account.evm).not.toBe(a.account.evm);
  });

  it("propagates NoPrfError rather than minting an unusable wallet", async () => {
    const broken = { ...fakePasskey(1), create: vi.fn().mockRejectedValue(new NoPrfError()) };
    await expect(createWallet({ passkey: broken as never, networkName: "Avok" })).rejects.toBeInstanceOf(NoPrfError);
  });
});
