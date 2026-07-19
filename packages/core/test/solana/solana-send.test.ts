import { describe, it, expect, vi } from "vitest";
import type { Address } from "viem";
import type { Connection } from "../../src/types.js";
import type { SolanaRpcClient, LatestBlockhash, KoraClient } from "../../src/solana/index.js";
import { createSolanaNamespace } from "../../src/client/solana.js";

const USER_ADDR = "11111111111111111111111111111111";
const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** Minimal Connection double whose signSolanaTransaction is spy-able. */
function fakeSolanaConnection(): Connection & { signSolanaCallCount: number } {
  const state = { signSolanaCallCount: 0 };
  return {
    account: () => ({
      evm: { address: "0x1111111111111111111111111111111111111111" as Address },
      solana: { address: USER_ADDR },
    }),
    status: () => true,
    async signSolanaTransaction(_messageBytes: Uint8Array) {
      state.signSolanaCallCount += 1;
      return {
        signature: "1111111111111111111111111111111111111111111111111111111111111111111111111111111111111",
        consent: undefined,
      };
    },
    get signSolanaCallCount() {
      return state.signSolanaCallCount;
    },
  } as unknown as Connection & { signSolanaCallCount: number };
}

function fakeSolanaRpc(opts?: { onGetLatestBlockhash?: () => void }): SolanaRpcClient {
  return {
    async getLatestBlockhash() {
      opts?.onGetLatestBlockhash?.();
      return {
        blockhash: "11111111111111111111111111111111" as LatestBlockhash["blockhash"],
        lastValidBlockHeight: 100n,
      };
    },
    async simulateTransaction() {
      return { err: null, unitsConsumed: 5_000n, logs: [] };
    },
    async sendTransaction() {
      return "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9dgxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    },
    async getSignatureStatus() {
      return null;
    },
    async getAccountInfo() {
      return { exists: true };
    },
    async getRecentPrioritizationFee() {
      return 0n;
    },
    async getMinimumBalanceForRentExemption() {
      return 2_039_280n; // rent-exempt minimum for a 165-byte token account
    },
    async getBlockHeight() {
      return 1n;
    },
  };
}

function fakeKora(): KoraClient {
  return {
    getPayerSigner: async () => ({ payment_address: USER_ADDR, signer_address: USER_ADDR }),
    getSupportedTokens: async () => [USDC_DEVNET],
    estimateTransactionFee: async () => ({
      feeInLamports: 5_000n,
      feeInToken: 10_456n,
      paymentAddress: USER_ADDR,
      signerPubkey: USER_ADDR,
    }),
    signAndSendTransaction: async () => ({ signature: "SIGFROMKORA" }),
  };
}

const fakeIx = { programAddress: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", accounts: [], data: new Uint8Array() };

describe("client.send", () => {
  it("self-pay send signs once and submits to the rpc", async () => {
    const connection = fakeSolanaConnection();
    const client = createSolanaNamespace({
      connection,
      deps: { solanaRpc: fakeSolanaRpc() },
    });
    const receipt = await client.send([fakeIx], { cluster: "devnet" });
    expect(receipt.rail).toBe("self-pay");
    expect(receipt.status).toBe("submitted");
    expect(connection.signSolanaCallCount).toBe(1);
  });

  it("sponsored send partial-signs ONCE and hands off to Kora", async () => {
    const connection = fakeSolanaConnection();
    const client = createSolanaNamespace({
      connection,
      koraUrl: "http://kora",
      deps: { solanaRpc: fakeSolanaRpc(), kora: fakeKora() },
    });
    const receipt = await client.send([fakeIx], { cluster: "devnet", feeToken: USDC_DEVNET });
    expect(receipt.rail).toBe("sponsored");
    expect(receipt.status).toBe("pending");
    // The receipt id IS the broadcast signature: Kora submits, so there is a real transaction to point
    // at immediately — no opaque intent id standing in for one.
    expect(receipt.id).toBe("SIGFROMKORA");
    expect(receipt.signature).toBe("SIGFROMKORA");
    // ONE passkey gesture. Every Kora round-trip (payer, quote) happens BEFORE it, so K is never live
    // across a network call.
    expect(connection.signSolanaCallCount).toBe(1);
  });

  it("reusing a SolanaSimulation does not rebuild the message and still submits", async () => {
    let blockhashCalls = 0;
    const connection = fakeSolanaConnection();
    const client = createSolanaNamespace({
      connection,
      deps: {
        solanaRpc: fakeSolanaRpc({
          onGetLatestBlockhash: () => {
            blockhashCalls += 1;
          },
        }),
      },
    });
    const sim = await client.simulate([fakeIx], { cluster: "devnet" });
    const callsAfterSimulate = blockhashCalls;
    expect(callsAfterSimulate).toBeGreaterThan(0);

    const receipt = await client.send(sim, {});
    expect(receipt.rail).toBe("self-pay");
    expect(receipt.status).toBe("submitted");
    // Reusing a prior simulation must not re-fetch a blockhash / rebuild the message.
    expect(blockhashCalls).toBe(callsAfterSimulate);
  });

  it("simulate and send-from-array resolve the same rail/cluster for identical input", async () => {
    const simConnection = fakeSolanaConnection();
    const simClient = createSolanaNamespace({
      connection: simConnection,
      deps: { solanaRpc: fakeSolanaRpc() },
    });
    const sim = await simClient.simulate([fakeIx], { cluster: "devnet" });

    const sendConnection = fakeSolanaConnection();
    const sendClient = createSolanaNamespace({
      connection: sendConnection,
      deps: { solanaRpc: fakeSolanaRpc() },
    });
    const receipt = await sendClient.send([fakeIx], { cluster: "devnet" });

    expect(receipt.rail).toBe(sim.resolved.rail);
    expect(receipt.cluster).toBe(sim.resolved.cluster);

    // Full resolved shape is deterministic for the self-pay path given the fixed fake rpc.
    expect(sim.resolved.rail).toBe("self-pay");
    expect(sim.resolved.feeToken).toBeUndefined();
    expect(sim.resolved.lastValidBlockHeight).toBe(100n);
    expect(sim.resolved.message).toBeDefined();
  });

  it("sponsored simulate resolves feeToken and Kora's quoted expectedFee", async () => {
    const connection = fakeSolanaConnection();
    const client = createSolanaNamespace({
      connection,
      koraUrl: "http://kora",
      deps: { solanaRpc: fakeSolanaRpc(), kora: fakeKora() },
    });
    const sim = await client.simulate([fakeIx], { cluster: "devnet", feeToken: USDC_DEVNET });

    expect(sim.resolved.rail).toBe("sponsored");
    expect(sim.resolved.feeToken).toBe(USDC_DEVNET);
    expect(sim.resolved.expectedFee).toBe(10_456n);
  });

  // The user asked not to pay SOL; where no fee payer is configured the honest answer is to self-pay,
  // not to refuse the send (SPEC-05 §1).
  it("sponsored send without a koraUrl falls back to self-pay", async () => {
    const connection = fakeSolanaConnection();
    const client = createSolanaNamespace({
      connection,
      deps: { solanaRpc: fakeSolanaRpc() },
    });
    const receipt = await client.send([fakeIx], { cluster: "devnet", feeToken: USDC_DEVNET });
    expect(receipt.rail).toBe("self-pay");
    expect(receipt.status).toBe("submitted");
  });

  it("send without a cluster rejects (cluster is required per-call, no silent default)", async () => {
    const client = createSolanaNamespace({
      connection: fakeSolanaConnection(),
      deps: { solanaRpc: fakeSolanaRpc() },
    });
    await expect(client.send([fakeIx], {})).rejects.toThrow(/cluster required/i);
  });
});
