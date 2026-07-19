import { describe, expect, it, test } from "vitest";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encryptKeyBlob } from "../../src/wallet/crypto/blob.js";
import { withDiscoveredKeys, withWalletKey, type WalletState } from "../../src/wallet/sandbox.js";
import { createWallet } from "../../src/wallet/wallet.js";
import { produceSolanaKey } from "../../src/wallet/crypto/container.js";
import { solanaAddressFromSecret } from "../../src/wallet/crypto/derive.js";
import { encodeAccessHandle } from "../../src/wallet/passkey/label.js";
import { FakePasskeyAdapter, makeFakePasskeyWithCounters } from "./fakes.js";

async function seed(pk: FakePasskeyAdapter): Promise<{ state: WalletState; privateKey: `0x${string}` }> {
  const privateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
  const address = privateKeyToAccount(privateKey).address;
  const container = { key: hexToBytes(privateKey) };
  const solanaAddress = solanaAddressFromSecret(produceSolanaKey(container));
  const reg = await pk.create("x", encodeAccessHandle(address, 10));
  const blob = await encryptKeyBlob({
    container, address, credentialId: reg.credentialId, prfOutput: reg.prfOutput,
  });
  return {
    state: { evmAddress: address, solanaAddress, slots: [{ credentialId: reg.credentialId, rpId: reg.rpId, transports: reg.transports, createdAt: "2026-01-01T00:00:00.000Z" }], blobs: [{ credentialId: reg.credentialId, blob }] },
    privateKey,
  };
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

  test("a state claiming the wrong address cannot decrypt the blob", async () => {
    // The wallet EVM address is bound into the AES `info` (it moved from the blob into a decrypt
    // parameter, supplied here as state.evmAddress). A tampered address derives a different key, so
    // AES-GCM's tag check fails and the blob won't even decrypt — a stronger rejection than the old
    // decrypt-then-compare, and the wrong wallet can never be signed for.
    const pk = new FakePasskeyAdapter();
    const { state } = await seed(pk);
    const tampered: WalletState = { ...state, evmAddress: "0x0000000000000000000000000000000000000001" };
    await expect(withWalletKey({ state: tampered, passkey: pk }, async () => 1)).rejects.toThrow();
  });

  it("withDiscoveredKeys signs BOTH rails with exactly one passkey assertion", async () => {
    const passkey = makeFakePasskeyWithCounters();
    const { account } = await createWallet({ passkey, networkName: "qudi.fi" });
    const out = await withDiscoveredKeys({ passkey }, async ({ evm, solana }, state) => {
      const evmSig = await evm.signMessage({ message: "login" });
      const solSig = await solana.sign(new TextEncoder().encode("login"));
      return { evmSig, solLen: solSig.length, evmAddr: evm.address, solAddr: solana.address, state };
    });
    expect(out.evmSig).toMatch(/^0x/);
    expect(out.solLen).toBe(64); // ed25519 signature
    expect(out.evmAddr.toLowerCase()).toBe(account.evm.toLowerCase());
    expect(out.solAddr).toBe(account.solana);
    // The whole point: ONE gesture unlocked both keys — no second prompt.
    expect(passkey.counts.discover).toBe(1);
    expect(passkey.counts.authenticate).toBe(0);
  });
});
