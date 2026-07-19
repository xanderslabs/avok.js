import { describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createWallet } from "../../src/wallet/wallet.js";
import { withSolanaKey } from "../../src/wallet/sandbox.js";
import { FakePasskeyAdapter } from "./fakes.js";

describe("withSolanaKey", () => {
  it("signs bytes with ed25519 verifiable under the wallet's Solana public key, in one gesture", async () => {
    const passkey = new FakePasskeyAdapter();
    const authSpy = vi.spyOn(passkey, "authenticate");
    const { state, account } = await createWallet({ passkey, networkName: "Avok" });

    const message = new TextEncoder().encode("hello solana");
    const { signature, publicKey, address } = await withSolanaKey({ state, passkey }, async (signer) => ({
      signature: await signer.sign(message),
      publicKey: signer.publicKey,
      address: signer.address,
    }));

    expect(address).toBe(account.solana);
    expect(ed25519.verify(signature, message, publicKey)).toBe(true);
    expect(authSpy).toHaveBeenCalledTimes(1); // one passkey gesture
  });

  it("rejects when the derived Solana address does not match state", async () => {
    const passkey = new FakePasskeyAdapter();
    const { state } = await createWallet({ passkey, networkName: "Avok" });
    const tampered = { ...state, solanaAddress: "1nvalidAddre55000000000000000000000000000000" };
    await expect(withSolanaKey({ state: tampered, passkey }, async () => "x")).rejects.toThrow();
  });
});
