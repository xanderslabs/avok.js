import { describe, it, expect, vi } from "vitest";
import {
  address,
  createNoopSigner,
  createTransactionMessage,
  compileTransaction,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from "@solana/kit";
import type { KoraClient } from "./index.js";
import { createSolanaEngine } from "../internal/solana-send.js";
import type { Connection } from "../types.js";

/**
 * The DAPP rail (Wallet Standard `solana:signAndSendTransaction`), where the dapp hands us a
 * transaction it already built.
 *
 * Kora is designed to be integrated at BUILD time: its documented flow sets the fee payer to Kora's
 * signer from step one, because a fee payer cannot be bolted onto a finished transaction. So the wallet
 * does not rewrite a dapp's transaction to front it. It reads who the dapp chose as fee payer and
 * routes accordingly:
 *
 *   fee payer = the user  → self-pay: we hold the only required signature, so our RPC can broadcast it.
 *   fee payer = anyone else (a Kora-aware dapp) → we hold ONE of TWO required signatures. Broadcasting
 *     that ourselves just bounces; it must go back to Kora, which co-signs as fee payer and submits.
 */

const USER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const KORA_SIGNER = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BLOCKHASH = "11111111111111111111111111111111" as Blockhash;
const USER_SIG = "1".repeat(88);

function fakeConnection(): Connection {
  return {
    account: () => ({ solana: { address: USER } }),
    signSolanaTransaction: async () => ({ signature: USER_SIG }),
  } as unknown as Connection;
}

function fakeKora(over: Partial<KoraClient> = {}): KoraClient {
  return {
    getPayerSigner: async () => ({ payment_address: KORA_SIGNER, signer_address: KORA_SIGNER }),
    getSupportedTokens: async () => [],
    estimateTransactionFee: async () => ({
      feeInLamports: 5_000n,
      feeInToken: 0n,
      paymentAddress: KORA_SIGNER,
      signerPubkey: KORA_SIGNER,
    }),
    signAndSendTransaction: async () => ({ signature: "5".repeat(88) }),
    ...over,
  };
}

/** A dapp-built wire transaction with `feePayer` as its fee payer. */
function wireTxWithFeePayer(feePayer: string): Uint8Array {
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(address(feePayer), tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 100n }, tx),
  );
  return getTransactionEncoder().encode(compileTransaction(msg)) as Uint8Array;
}

describe("solana engine: signAndSend routing", () => {
  it("self-pay (the dapp made the user the fee payer): broadcasts via our RPC", async () => {
    const sendTransaction = vi.fn(async () => "3".repeat(88));
    const kora = fakeKora({ signAndSendTransaction: vi.fn() });
    const engine = createSolanaEngine({
      connection: fakeConnection(),
      koraUrl: "https://kora.test",
      deps: { solanaRpc: { sendTransaction } as never, kora },
    } as never);

    const sig = await engine.signAndSend(wireTxWithFeePayer(USER), "devnet");

    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(kora.signAndSendTransaction).not.toHaveBeenCalled();
    expect(sig).toBeInstanceOf(Uint8Array);
  });

  it("a Kora-aware dapp's transaction goes back to Kora, not to our RPC", async () => {
    const sendTransaction = vi.fn(async () => "3".repeat(88));
    const signAndSendTransaction = vi.fn(async () => ({ signature: "5".repeat(88) }));
    const kora = fakeKora({ signAndSendTransaction });
    const engine = createSolanaEngine({
      connection: fakeConnection(),
      koraUrl: "https://kora.test",
      deps: { solanaRpc: { sendTransaction } as never, kora },
    } as never);

    const sig = await engine.signAndSend(wireTxWithFeePayer(KORA_SIGNER), "devnet");

    // Our RPC cannot broadcast a transaction still missing its fee payer's signature.
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
    expect(sig).toBeInstanceOf(Uint8Array);
  });

  // Failing loudly beats broadcasting a transaction that cannot land: the RPC would reject it for a
  // missing signature, which says nothing about the actual misconfiguration.
  it("refuses a foreign-fee-payer transaction when no Kora is configured", async () => {
    const engine = createSolanaEngine({
      connection: fakeConnection(),
      deps: { solanaRpc: { sendTransaction: vi.fn() } as never },
    } as never);

    await expect(engine.signAndSend(wireTxWithFeePayer(KORA_SIGNER), "devnet")).rejects.toThrow(/fee payer|koraUrl/i);
  });
});
