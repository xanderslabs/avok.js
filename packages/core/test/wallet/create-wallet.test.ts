import { describe, it, expect, vi } from "vitest";
import { createWallet } from "../../src/wallet/wallet.js";
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
      return {
        credentialId: "Y3JlZC0x",
        prfOutput: new Uint8Array(32).fill(prfFill).buffer,
        userHandle: self.lastHandle!,
      };
    },
  };
  return self as unknown as PasskeyAdapter & { lastHandle?: Uint8Array };
};

describe("createWallet (D8, PRF-derived)", () => {
  it("stores no key material — the passkey IS the wallet", async () => {
    // The bug this design exists to kill: a fresh wallet held only in memory is destroyed by logout.
    // The passkey IS the wallet, so there is nothing to store and nothing to lose.
    const { state } = await createWallet({ passkey: fakePasskey(3), networkName: "Avok" });
    expect(JSON.stringify(state)).not.toMatch(/[0-9a-f]{64}/i); // no raw 32-byte key anywhere
  });

  it("state is coherent and carries no tx artifacts", async () => {
    // create() touches no chain: the state's address matches the returned account, and nothing in
    // the serialized state resembles an authorization/intent/signature.
    const { account, state } = await createWallet({ passkey: fakePasskey(3), networkName: "Avok" });
    expect(state.evmAddress).toBe(account.evm);
    expect(state.credentialId).toBe("Y3JlZC0x");
    expect(JSON.stringify(state)).not.toMatch(/authorization|intent|signature/i);
  });

  it("mints a fresh random user handle each time (no primary/secondary encoding under D8)", async () => {
    const passkey = fakePasskey(3);
    await createWallet({ passkey, networkName: "Avok" });
    expect(passkey.lastHandle).toBeInstanceOf(Uint8Array);
    expect(passkey.lastHandle!.length).toBe(32);
  });

  it("the same PRF output always yields the same addresses", async () => {
    const a = await createWallet({ passkey: fakePasskey(5), networkName: "Avok" });
    const b = await createWallet({ passkey: fakePasskey(5), networkName: "Avok" });
    expect(b.account.evm).toBe(a.account.evm);
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
