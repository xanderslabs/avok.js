import { describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { createWallet } from "@avokjs/wallet-core";
import { toKitSigner } from "../src/signer.js";

// Minimal passkey fake: deterministic PRF per credential, largeBlob backed.
class FakePasskeyAdapter {
  private readonly credentials = new Map<string, { prfOutput: ArrayBuffer }>();
  private readonly largeBlobs = new Map<string, Uint8Array>();
  private counter = 0;

  async create(_label: string, _address: string): Promise<{
    credentialId: string; prfOutput: ArrayBuffer; transports: string[];
    rpId: string; prf: { extension: "prf"; saltVersion: "v0" };
    platform: { authenticatorAttachment: "platform" }; largeBlobSupported: boolean;
  }> {
    this.counter += 1;
    const credentialId = `fake-cred-${this.counter}`;
    const prfOutput = new Uint8Array(Array.from({ length: 32 }, (_, i) => (this.counter * 17 + i) % 256)).buffer;
    this.credentials.set(credentialId, { prfOutput });
    return {
      credentialId,
      prfOutput,
      transports: ["internal"],
      rpId: "test.local",
      prf: { extension: "prf", saltVersion: "v0" },
      platform: { authenticatorAttachment: "platform" },
      largeBlobSupported: true,
    };
  }

  async authenticate(credentialId: string): Promise<ArrayBuffer> {
    const cred = this.credentials.get(credentialId);
    if (!cred) throw new Error(`Unknown credential: ${credentialId}`);
    return cred.prfOutput.slice(0); // fresh buffer per call: sandbox zeroes prfOutput (single-use contract)
  }

  async discover(): Promise<never> { throw new Error("not needed"); }
  async supportsLargeBlob(): Promise<boolean> { return true; }

  async writeLargeBlob(credentialId: string, _t: string[] | undefined, bytes: Uint8Array): Promise<boolean> {
    if (!this.credentials.has(credentialId)) return false;
    this.largeBlobs.set(credentialId, bytes);
    return true;
  }

  async readLargeBlob(credentialId: string): Promise<Uint8Array | null> {
    return this.largeBlobs.get(credentialId) ?? null;
  }
}

describe("toKitSigner", () => {
  it("signs the transaction message bytes with one passkey gesture, verifiable under the wallet pubkey", async () => {
    const passkey = new FakePasskeyAdapter();
    const authSpy = vi.spyOn(passkey, "authenticate");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { state, account } = await createWallet({ passkey: passkey as any, networkName: "Avok" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signer = toKitSigner({ state, passkey: passkey as any });
    expect(signer.address).toBe(account.solana);

    const messageBytes = new Uint8Array([1, 2, 3, 4]);
    const fakeTx = { messageBytes } as never;
    const [dict] = await signer.signTransactions([fakeTx]);

    const sig = dict[signer.address];
    // Exactly ONE passkey gesture for the whole signTransactions call.
    expect(authSpy).toHaveBeenCalledTimes(1);
    // The returned value must be a Uint8Array.
    expect(sig).toBeInstanceOf(Uint8Array);
    // Verify the signature against the wallet's Solana public key (base58 decode address → 32 bytes).
    const pubkey = base58.decode(signer.address);
    expect(ed25519.verify(sig, messageBytes, pubkey)).toBe(true);
  });

  it("signs multiple transactions with a single gesture", async () => {
    const passkey = new FakePasskeyAdapter();
    const authSpy = vi.spyOn(passkey, "authenticate");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signer = toKitSigner({ state, passkey: passkey as any });

    const msg1 = new Uint8Array([0xaa, 0xbb]);
    const msg2 = new Uint8Array([0xcc, 0xdd]);
    const [d1, d2] = await signer.signTransactions([
      { messageBytes: msg1 } as never,
      { messageBytes: msg2 } as never,
    ]);

    // Still only ONE gesture for the batch.
    expect(authSpy).toHaveBeenCalledTimes(1);

    const pubkey = base58.decode(signer.address);
    expect(ed25519.verify(d1[signer.address], msg1, pubkey)).toBe(true);
    expect(ed25519.verify(d2[signer.address], msg2, pubkey)).toBe(true);
  });
});
