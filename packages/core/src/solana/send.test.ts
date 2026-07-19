import { address, signTransactionMessageWithSigners, partiallySignTransactionMessageWithSigners } from "@solana/kit";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createWallet } from "../wallet/index.js";
import { buildSolanaMessage } from "./build.js";
import { toKitSigner } from "./signer.js";
import { sendSolana } from "./send.js";
import type { SolanaRpcClient } from "./rpc.js";
import type { KoraClient } from "./kora.js";

// ── FakePasskeyAdapter ────────────────────────────────────────────────────────
class FakePasskeyAdapter {
  private readonly credentials = new Map<string, { prfOutput: ArrayBuffer }>();
  private readonly largeBlobs = new Map<string, Uint8Array>();
  private counter = 0;

  async create(_label: string, _address: string) {
    this.counter += 1;
    const credentialId = `fake-cred-${this.counter}`;
    const prfOutput = new Uint8Array(Array.from({ length: 32 }, (_, i) => (this.counter * 17 + i) % 256)).buffer;
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

// ── Shared dummy instruction + blockhash ─────────────────────────────────────
const DUMMY_BLOCKHASH = "CSymwgTNX1j3E4qhKfJAUoHTwjMfAnkd9izNNos98opr";
const RELAYER_ADDRESS = "So11111111111111111111111111111111111111112";

function makeFakeRpc(sendSignature = "fake-sig-0001") {
  return {
    getLatestBlockhash: async () => ({ blockhash: DUMMY_BLOCKHASH, lastValidBlockHeight: 9999n }),
    sendTransaction: vi.fn(async (_base64: string) => sendSignature),
    simulateTransaction: async () => ({ err: null, unitsConsumed: 100n, logs: [] }),
    getSignatureStatus: async () => null,
    getAccountInfo: async () => ({ exists: false }),
    getRecentPrioritizationFee: async () => 0n,
    getBlockHeight: async () => 100n,
    // The fake stands in for the real client; keep `sendTransaction` as a Mock so tests can
    // introspect its calls, while satisfying the SolanaRpcClient contract at the boundary.
  } as unknown as SolanaRpcClient & { sendTransaction: Mock };
}

const userInstruction = {
  programAddress: address("11111111111111111111111111111111"),
  accounts: [],
  data: new Uint8Array(0),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sendSolana – self-pay", () => {
  it("signs fully (all signature slots filled), calls rpc.sendTransaction once, returns Receipt{rail:self-pay,status:submitted}", async () => {
    const passkey = new FakePasskeyAdapter();
    const authSpy = vi.spyOn(passkey, "authenticate");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signer = toKitSigner({ state, passkey: passkey as any });

    const fakeRpc = makeFakeRpc("real-sig-abc");
    const { message, lastValidBlockHeight } = await buildSolanaMessage({
      rpc: fakeRpc,
      instructions: [userInstruction],
      feePayer: { kind: "signer", signer },
      computeUnitLimit: 100_000,
      computeUnitPrice: 0n,
    });

    const receipt = await sendSolana({
      rail: "self-pay",
      message,
      lastValidBlockHeight,
      cluster: "devnet",
      rpc: fakeRpc,
    });

    // ONE passkey gesture (sendSolana itself — assert before the extra signing below)
    expect(authSpy).toHaveBeenCalledTimes(1);

    // rpc.sendTransaction called once
    expect(fakeRpc.sendTransaction).toHaveBeenCalledTimes(1);

    // Receipt shape
    expect(receipt.rail).toBe("self-pay");
    expect(receipt.status).toBe("submitted");
    expect(receipt.cluster).toBe("devnet");
    expect(receipt.signature).toBe("real-sig-abc");
    expect(receipt.id).toBe("real-sig-abc");

    // The base64 passed to sendTransaction should be a non-empty string
    const [base64Arg] = fakeRpc.sendTransaction.mock.calls[0] as [string];
    expect(typeof base64Arg).toBe("string");
    expect(base64Arg.length).toBeGreaterThan(0);

    // Signature-map: FULLY signed — every slot must be non-null
    // Sign the same message independently to inspect the kit signatures object.
    // (kit messages are immutable; this is a separate gesture used only for assertion.)
    const fullySignedForAssertion = await signTransactionMessageWithSigners(message as never);
    const fullSigs = fullySignedForAssertion.signatures as Record<string, Uint8Array | null>;
    const fullEntries = Object.entries(fullSigs);
    expect(fullEntries.length).toBeGreaterThan(0);
    for (const [, sigBytes] of fullEntries) {
      expect(sigBytes).not.toBeNull();
    }
  });
});

/** A fake Kora node: records what it was asked to broadcast, answers with a fixed signature. */
function fakeKora(): KoraClient & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    getPayerSigner: async () => ({ payment_address: RELAYER_ADDRESS, signer_address: RELAYER_ADDRESS }),
    getSupportedTokens: async () => ["USDC"],
    estimateTransactionFee: async () => ({
      feeInLamports: 5000n,
      feeInToken: 500n,
      paymentAddress: RELAYER_ADDRESS,
      signerPubkey: RELAYER_ADDRESS,
    }),
    signAndSendTransaction: async (txB64: string) => {
      sent.push(txB64);
      return { signature: "SIGFROMKORA" };
    },
  };
}

describe("sendSolana – sponsored", () => {
  it("partially signs (user slot filled, Kora fee-payer slot null), hands the wire tx to Kora once, returns Receipt{rail:sponsored,status:pending}", async () => {
    const passkey = new FakePasskeyAdapter();
    const authSpy = vi.spyOn(passkey, "authenticate");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signer = toKitSigner({ state, passkey: passkey as any });

    const fakeRpc = makeFakeRpc();

    // Add the user signer as an account meta so partiallySign picks it up.
    // We inject the signer into the message's accounts via a mock instruction.
    // APPROACH: use a user instruction that references the signer address so kit
    // detects it as a required signer.  The instruction has the user as a writable
    // signer account.
    const userSignerInstruction = {
      programAddress: address("11111111111111111111111111111111"),
      accounts: [
        {
          address: signer.address,
          role: 3, // writable + signer (TransactionAccountRole.WRITABLE_SIGNER = 3)
          signer,
        },
      ],
      data: new Uint8Array(0),
    };

    const { message: sponsoredMsg, lastValidBlockHeight: sponsoredHeight } = await buildSolanaMessage({
      rpc: fakeRpc,
      instructions: [userSignerInstruction],
      feePayer: { kind: "address", address: RELAYER_ADDRESS },
      computeUnitLimit: 100_000,
      computeUnitPrice: 0n,
    });

    const kora = fakeKora();

    const receipt = await sendSolana({
      rail: "sponsored",
      message: sponsoredMsg,
      lastValidBlockHeight: sponsoredHeight,
      cluster: "devnet",
      kora,
    });

    // ONE passkey gesture (sendSolana itself — assert before the extra signing below)
    expect(authSpy).toHaveBeenCalledTimes(1);

    // Kora was handed the wire transaction, exactly once.
    expect(kora.sent).toHaveLength(1);
    expect(typeof kora.sent[0]).toBe("string");

    // Receipt shape. The id IS the signature now: Kora broadcast it, so there is a real transaction to
    // point at immediately. The bespoke relayer returned an opaque INTENT id and no signature at all,
    // which is why a sponsored receipt could not be linked to an explorer until the relayer was polled.
    expect(receipt.rail).toBe("sponsored");
    expect(receipt.status).toBe("pending");
    expect(receipt.cluster).toBe("devnet");
    expect(receipt.id).toBe("SIGFROMKORA");
    expect(receipt.signature).toBe("SIGFROMKORA");
    // Carried so `wait` can call a never-landable transaction expired instead of pending forever.
    expect(receipt.lastValidBlockHeight).toBe(sponsoredHeight);

    // Signature-map: PARTIALLY signed — user slot filled, Kora's fee-payer slot left null for Kora.
    // Sign the same message independently to inspect the kit signatures object.
    const partialForAssertion = await partiallySignTransactionMessageWithSigners(sponsoredMsg as never);
    const partialSigs = partialForAssertion.signatures as Record<string, Uint8Array | null>;
    expect(partialSigs[signer.address]).not.toBeNull();
    expect(partialSigs[RELAYER_ADDRESS]).toBeNull();
  });
});

describe("sendSolana – guard clauses", () => {
  it("throws if self-pay is called without rpc", async () => {
    await expect(
      sendSolana({ rail: "self-pay", message: {} as never, lastValidBlockHeight: 0n, cluster: "devnet" }),
    ).rejects.toThrow("rpc");
  });

  // A missing Kora here is a programming error, not a rail choice: the caller already decided this send
  // is sponsored. Falling back to self-pay at THIS depth would silently bill a user who chose not to pay
  // — the fallback belongs upstream, where the rail is still being chosen (sdk-core `assemble`).
  it("throws if sponsored is called without a kora client", async () => {
    await expect(
      sendSolana({ rail: "sponsored", message: {} as never, lastValidBlockHeight: 0n, cluster: "devnet" }),
    ).rejects.toThrow("kora");
  });
});
