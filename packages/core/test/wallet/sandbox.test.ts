import { describe, expect, it, test } from "vitest";
import { withDiscoveredKeys, withWalletKey, type WalletState } from "../../src/wallet/sandbox.js";
import { createWallet } from "../../src/wallet/wallet.js";
import { FakePasskeyAdapter, makeFakePasskeyWithCounters } from "./fakes.js";

async function seed(pk: FakePasskeyAdapter): Promise<{ state: WalletState }> {
  const { state } = await createWallet({ passkey: pk, networkName: "avok.test" });
  return { state };
}

describe("sandbox", () => {
  test("withWalletKey yields an account for the wallet address; never the key", async () => {
    const pk = new FakePasskeyAdapter();
    const { state } = await seed(pk);
    const addr = await withWalletKey({ state, passkey: pk }, async (account) => account.address);
    expect(addr).toBe(state.evmAddress);
  });

  test("signMessage recovers to the wallet address (bytes-native signer matches viem)", async () => {
    const pk = new FakePasskeyAdapter();
    const { state } = await seed(pk);
    const sig = await withWalletKey({ state, passkey: pk }, (account) => account.signMessage({ message: "hello" }));
    const { recoverMessageAddress } = await import("viem");
    const recovered = await recoverMessageAddress({ message: "hello", signature: sig });
    expect(recovered.toLowerCase()).toBe(state.evmAddress.toLowerCase());
  });

  test("a state claiming the wrong address refuses to sign under it", async () => {
    // The wallet address is checked against what the credential's own PRF derives — a tampered
    // state cannot make the sandbox sign under an address it does not control.
    const pk = new FakePasskeyAdapter();
    const { state } = await seed(pk);
    const tampered: WalletState = { ...state, evmAddress: "0x0000000000000000000000000000000000000001" };
    await expect(withWalletKey({ state: tampered, passkey: pk }, async () => 1)).rejects.toThrow();
  });

  it("withDiscoveredKeys signs with exactly one passkey assertion", async () => {
    const passkey = makeFakePasskeyWithCounters();
    const { account } = await createWallet({ passkey, networkName: "avok.test" });
    const out = await withDiscoveredKeys({ passkey }, async ({ evm }, state) => {
      const evmSig = await evm.signMessage({ message: "login" });
      return { evmSig, evmAddr: evm.address, state };
    });
    expect(out.evmSig).toMatch(/^0x/);
    expect(out.evmAddr.toLowerCase()).toBe(account.evm.toLowerCase());
    // The whole point: ONE gesture unlocked the key — no second prompt.
    expect(passkey.counts.discover).toBe(1);
    expect(passkey.counts.authenticate).toBe(0);
  });
});
