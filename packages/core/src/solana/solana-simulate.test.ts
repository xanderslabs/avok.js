import { describe, it, expect, vi } from "vitest";
import type { Address } from "viem";
import type { Connection } from "../types.js";
import type { SolanaRpcClient, LatestBlockhash, KoraClient } from "./index.js";
import { createSolanaNamespace } from "../client/solana.js";

const USER_ADDR = "11111111111111111111111111111111";
const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** Minimal Connection double whose signSolanaTransaction is spy-able. */
function fakeSolanaConnection(opts?: { onSign?: () => void }): Connection {
  return {
    account: () => ({
      evm: { address: "0x1111111111111111111111111111111111111111" as Address },
      solana: { address: USER_ADDR },
    }),
    status: () => true,
    async signSolanaTransaction(_messageBytes: Uint8Array) {
      opts?.onSign?.();
      return { signature: "1111111111111111111111111111111111111111111111111111111111111111111111111111111111111", consent: undefined };
    },
  } as unknown as Connection;
}

function fakeSolanaRpc(): SolanaRpcClient {
  return {
    async getLatestBlockhash() {
      return {
        blockhash: "11111111111111111111111111111111" as LatestBlockhash["blockhash"],
        lastValidBlockHeight: 100n,
      };
    },
    async simulateTransaction() {
      return { err: null, unitsConsumed: 5_000n, logs: [] };
    },
    async sendTransaction() {
      throw new Error("not used in simulate");
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
    signAndSendTransaction: async () => ({ signature: "SIG" }),
  };
}

const fakeIx = { programAddress: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", accounts: [], data: new Uint8Array() };

describe("client.simulate", () => {
  it("self-pay simulate builds with the user as fee payer and does not sign", async () => {
    let signed = false;
    const connection = fakeSolanaConnection({ onSign: () => { signed = true; } });
    const client = createSolanaNamespace({
      connection,
      deps: { solanaRpc: fakeSolanaRpc() },
    });
    const sim = await client.simulate([fakeIx], { cluster: "devnet" });
    expect(sim.success).toBe(true);
    expect(sim.resolved.rail).toBe("self-pay");
    expect(signed).toBe(false);
  });

  it("explicit feeToken:null forces self-pay (parity with EVM)", async () => {
    let signed = false;
    const connection = fakeSolanaConnection({ onSign: () => { signed = true; } });
    const client = createSolanaNamespace({
      connection,
      koraUrl: "http://kora",
      deps: { solanaRpc: fakeSolanaRpc(), kora: fakeKora() },
    });
    // An explicit null in opts forces self-pay — no quote, no sign — even with a Kora configured.
    const sim = await client.simulate([fakeIx], { cluster: "devnet", feeToken: null });
    expect(sim.resolved.rail).toBe("self-pay");
    expect(signed).toBe(false);
  });

  it("sponsored simulate quotes the fee + assembles the SPL fee instruction", async () => {
    const connection = fakeSolanaConnection();
    const client = createSolanaNamespace({
      connection,
      koraUrl: "http://kora",
      deps: { solanaRpc: fakeSolanaRpc(), kora: fakeKora() },
    });
    const sim = await client.simulate([fakeIx], { cluster: "devnet", feeToken: USDC_DEVNET });
    expect(sim.resolved.rail).toBe("sponsored");
    expect(sim.resolved.expectedFee).toBe(10_456n);
  });

  // Sponsoring is an OFFER, not a promise: the user asked not to pay SOL, and where no fee payer is
  // configured the honest answer is to self-pay, not to refuse the send outright (SPEC-05 §1).
  it("falls back to self-pay when a feeToken is set but no Kora is configured", async () => {
    const connection = fakeSolanaConnection();
    const client = createSolanaNamespace({
      connection,
      deps: { solanaRpc: fakeSolanaRpc() },
    });
    const sim = await client.simulate([fakeIx], { cluster: "devnet", feeToken: USDC_DEVNET });
    expect(sim.resolved.rail).toBe("self-pay");
    expect(sim.resolved.expectedFee).toBeUndefined();
  });
});
