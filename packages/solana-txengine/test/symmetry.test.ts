/**
 * Own-origin↔shared-origin signing symmetry — the load-bearing guarantee of the whole design.
 *
 * toKitSigner  (own-origin)   signs tx.messageBytes via withSolanaKey inside the sandbox.
 * toRemoteKitSigner (shared-origin, tunnel-backed) calls an injected `sign` function.
 *
 * This test wires the shared-origin signer's `sign` to the SAME sandbox key via withSolanaKey,
 * simulating the network tunnel reaching the origin's sandbox.  Both paths sign identical
 * bytes with the same ed25519 key — so they MUST produce byte-identical signatures.
 * That identity is what lets sendSolana work unchanged in both connection modes.
 */
import { compileTransaction, address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { createWallet, withSolanaKey } from "@avokjs/wallet-core";
import { buildSolanaMessage } from "../src/build.js";
import { toKitSigner, toRemoteKitSigner } from "../src/signer.js";

// ── Minimal inline passkey fake (same pattern as send.test.ts) ─────────────────
class FakePasskeyAdapter {
  private readonly credentials = new Map<string, { prfOutput: ArrayBuffer }>();
  private readonly largeBlobs = new Map<string, Uint8Array>();
  private counter = 0;

  async create(_label: string, _addr: string) {
    this.counter += 1;
    const credentialId = `fake-cred-${this.counter}`;
    const prfOutput = new Uint8Array(
      Array.from({ length: 32 }, (_, i) => (this.counter * 17 + i) % 256),
    ).buffer;
    this.credentials.set(credentialId, { prfOutput });
    return {
      credentialId,
      prfOutput,
      transports: ["internal"],
      rpId: "test.local",
      prf: { extension: "prf" as const, saltVersion: "v0" as const },
      platform: { authenticatorAttachment: "platform" as const },
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

// ── Shared constants ───────────────────────────────────────────────────────────
const DUMMY_BLOCKHASH = "CSymwgTNX1j3E4qhKfJAUoHTwjMfAnkd9izNNos98opr";

function makeFakeRpc() {
  return {
    getLatestBlockhash: async () => ({ blockhash: DUMMY_BLOCKHASH, lastValidBlockHeight: 9999n }),
    sendTransaction: async (_base64: string) => "fake-sig",
    simulateTransaction: async () => ({ err: null, unitsConsumed: 100n, logs: [] }),
    getSignatureStatus: async () => null,
    getAccountInfo: async () => ({ exists: false }),
    getRecentPrioritizationFee: async () => 0n,
    getBlockHeight: async () => 100n,
  } as never;
}

const DUMMY_INSTRUCTION = {
  programAddress: address("11111111111111111111111111111111"),
  accounts: [],
  data: new Uint8Array(0),
};

// ── Test ───────────────────────────────────────────────────────────────────────
describe("own-origin↔shared-origin signing symmetry", () => {
  it("local (toKitSigner) and shared-origin (toRemoteKitSigner) yield byte-identical signatures for the same key and message", async () => {
    // 1. One wallet → one Solana key in the sandbox
    const passkey = new FakePasskeyAdapter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
    const solanaAddress = state.solanaAddress as ReturnType<typeof address>;

    // 2. Build a self-pay message and compile it to get the canonical messageBytes
    const fakeRpc = makeFakeRpc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const localSigner = toKitSigner({ state, passkey: passkey as any });
    const { message } = await buildSolanaMessage({
      rpc: fakeRpc,
      instructions: [DUMMY_INSTRUCTION],
      feePayer: { kind: "signer", signer: localSigner },
      computeUnitLimit: 100_000,
      computeUnitPrice: 0n,
    });
    const tx = compileTransaction(message as never);

    // 3. Shared-origin signer: same address, but sign via the tunnel-simulated withSolanaKey call.
    //    This is the production contract: the network origin receives the raw messageBytes
    //    from the tunnel and signs them with the same sandbox key.
    const remoteSigner = toRemoteKitSigner({
      address: solanaAddress,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sign: (bytes) => withSolanaKey({ state, passkey: passkey as any }, (s) => s.sign(bytes)),
    });

    // 4. Both signers sign the same compiled transaction
    const [localDict] = await localSigner.signTransactions([tx]);
    const [remoteDict] = await remoteSigner.signTransactions([tx]);

    // 5. Byte-identical: same ed25519 key + same message bytes → same deterministic signature
    expect(localDict[solanaAddress]).toBeInstanceOf(Uint8Array);
    expect(remoteDict[solanaAddress]).toBeInstanceOf(Uint8Array);
    expect(remoteDict[solanaAddress]).toEqual(localDict[solanaAddress]);
  });
});
