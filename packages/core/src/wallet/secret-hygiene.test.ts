import { describe, expect, test } from "vitest";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encryptKeyBlob } from "./crypto/blob.js";
import { createPasskeyCredential } from "./enrolment.js";
import { withDecryptedContainer, withWalletKey, type WalletState } from "./sandbox.js";
import { produceSolanaKey } from "./crypto/container.js";
import { solanaAddressFromSecret } from "./crypto/derive.js";
import type { PasskeyAdapter } from "./passkey/adapter.js";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

// A secondary-style state whose single blob decrypts under `prfBytes`. The fake mints a FRESH
// prfOutput buffer per authenticate() — honouring the PasskeyAdapter single-use contract — and
// records each minted buffer so a test can inspect it AFTER the sandbox to prove it was zeroed.
async function makeState(): Promise<{ state: WalletState; passkey: PasskeyAdapter; mintedPrf: ArrayBuffer[] }> {
  const prfBytes = new Uint8Array(32).fill(5);
  const address = privateKeyToAccount(PK).address;
  const container = { key: hexToBytes(PK) };
  const solanaAddress = solanaAddressFromSecret(produceSolanaKey(container));
  const credentialId = "Y3JlZC1o";
  const blob = await encryptKeyBlob({
    container,
    address,
    credentialId,
    prfOutput: prfBytes.slice().buffer,
  });
  const mintedPrf: ArrayBuffer[] = [];
  const passkey = {
    async authenticate() {
      const buf = prfBytes.slice().buffer; // fresh instance per call (real-adapter behaviour)
      mintedPrf.push(buf);
      return buf;
    },
    async create() { throw new Error("unused"); },
    async discover() { throw new Error("unused"); },
  } as unknown as PasskeyAdapter;
  const state: WalletState = {
    evmAddress: address,
    solanaAddress,
    slots: [{ credentialId, rpId: "avok.test", transports: ["internal"], createdAt: "2026-01-01T00:00:00.000Z" }],
    blobs: [{ credentialId, blob }],
  };
  return { state, passkey, mintedPrf };
}

describe("what must NOT be wiped: a registration's PRF belongs to the adapter", () => {
  test("createPasskeyCredential leaves the adapter's registration PRF intact — wiping it would brick the passkey", async () => {
    // The rule differs by direction, and getting it backwards is catastrophic. The single-use PRF from
    // authenticate()/discover() IS wiped (above). A REGISTRATION's prfOutput is NOT ours: an adapter may
    // hand back a buffer it still owns (our fakes do), and zeroing it zeroes the credential itself —
    // producing a passkey that enrols, lists, and can never be opened. addPasskey/adoptContainer leave it
    // alone; so must createLifeboatCredential.
    const owned = new Uint8Array(32).fill(7); // the adapter's buffer, handed out by create()
    const passkey = {
      async create() {
        return {
          credentialId: "Y3JlZC1saWZlYm9hdA",
          prfOutput: owned.buffer, // the SAME buffer the adapter keeps — as a real one may
          transports: ["internal"],
          rpId: "lifeboat.example",
          prf: { extension: "prf", saltVersion: "v0" } as const,
          platform: { authenticatorAttachment: "platform" } as const,
        };
      },
      async authenticate() { throw new Error("unused"); },
      async discover() { throw new Error("unused"); },
    } as unknown as PasskeyAdapter;

    await createPasskeyCredential({
      passkey,
      networkName: "lifeboat.example",
      evm: privateKeyToAccount(PK).address,
      anchorChainId: 10,
    });

    expect(Array.from(owned)).toEqual(new Array(32).fill(7));
  });
});

describe("derive/use/clear — the wipe actually happens", () => {
  test("the container key K is zeroed after a signing operation", async () => {
    const { state, passkey } = await makeState();
    let captured: Uint8Array | undefined;
    await withDecryptedContainer({ state, passkey }, async (container) => {
      captured = container.key;
      // Sanity: K is live and non-zero WHILE we are inside the sandbox.
      expect(captured.some((b) => b !== 0)).toBe(true);
      // A real use of K: build the signing account and sign.
      return withWalletKey({ state, passkey }, (account) => account.signMessage({ message: "x" }));
    });
    // After the funnel's `finally`, K must be all zeros.
    expect(captured).toBeDefined();
    expect(Array.from(captured!)).toEqual(new Array(32).fill(0));
  });

  test("the PRF output (the seed of K) is zeroed after the sandbox completes", async () => {
    const { state, passkey, mintedPrf } = await makeState();
    await withDecryptedContainer({ state, passkey }, async () => "done");
    // Exactly one gesture happened; the buffer the adapter handed the sandbox must be zeroed.
    expect(mintedPrf).toHaveLength(1);
    expect(Array.from(new Uint8Array(mintedPrf[0]))).toEqual(new Array(32).fill(0));
  });

  test("a throwing fn still wipes K and the PRF output (the finally path)", async () => {
    const { state, passkey, mintedPrf } = await makeState();
    let captured: Uint8Array | undefined;
    await expect(
      withDecryptedContainer({ state, passkey }, async (container) => {
        captured = container.key;
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);
    expect(Array.from(captured!)).toEqual(new Array(32).fill(0));
    expect(Array.from(new Uint8Array(mintedPrf[0]))).toEqual(new Array(32).fill(0));
  });
});
