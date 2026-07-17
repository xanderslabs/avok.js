import { describe, expect, it } from "vitest";
import { address, createNoopSigner, type Instruction } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { buildKoraFeePayment } from "../src/kora-fee.js";
import { associatedTokenAddress } from "../src/spl.js";
import type { KoraClient } from "../src/kora.js";

// All addresses are valid 32-byte base58-encoded Solana public keys (mirrors spl.test.ts).
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC mint
const USER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"; // stand-in owner
const PAYMENT_ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"; // where Kora wants to be paid
const KORA_SIGNER = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"; // Kora's fee payer

const FEE_IN_TOKEN = 10456n;

function fakeKora(): KoraClient & { estimated: { txB64: string; feeToken: string }[] } {
  const estimated: { txB64: string; feeToken: string }[] = [];
  return {
    estimated,
    getPayerSigner: async () => ({ payment_address: PAYMENT_ADDRESS, signer_address: KORA_SIGNER }),
    getSupportedTokens: async () => [MINT],
    estimateTransactionFee: async (txB64: string, feeToken: string) => {
      estimated.push({ txB64, feeToken });
      return {
        feeInLamports: 5000n,
        feeInToken: FEE_IN_TOKEN,
        paymentAddress: PAYMENT_ADDRESS,
        signerPubkey: KORA_SIGNER,
      };
    },
    signAndSendTransaction: async () => ({ signature: "SIG" }),
  };
}

/** Instruction account addresses, in order. Kit types them readonly and as a lookup/meta union. */
const accountAddresses = (ix: Instruction): string[] =>
  (ix.accounts ?? []).map((a) => (a as { address: string }).address);

/** The user's source ATA must exist (we cannot fund it); the destination presence is the variable. */
const fakeRpc = (destPresent: boolean) => {
  const source = associatedTokenAddress(MINT, USER, TOKEN_PROGRAM_ADDRESS);
  return {
    getAccountInfo: async (addr: string) => ({ exists: addr === (await source) ? true : destPresent }),
  } as never;
};

describe("buildKoraFeePayment", () => {
  it("prices the REAL transaction and pays exactly fee_in_token to payment_address", async () => {
    const kora = fakeKora();
    const authority = createNoopSigner(address(USER));

    const { instructions, quote } = await buildKoraFeePayment({
      kora,
      rpc: fakeRpc(true),
      txB64: "BASE64TX",
      feeToken: MINT,
      from: USER,
      authority,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      decimals: 6,
    });

    // Kora simulates what it is being asked to pay for, so the estimate must see the ACTUAL bytes —
    // a stub would be priced, and then the real thing would cost something else.
    expect(kora.estimated).toEqual([{ txB64: "BASE64TX", feeToken: MINT }]);

    // The amount the user signs IS the quote. If these ever drift, the user consents to one number and
    // pays another — and Kora refuses the transaction for underpayment.
    expect(quote.feeInToken).toBe(FEE_IN_TOKEN);
    expect(instructions).toHaveLength(1);
    expect(instructions[0]!.programAddress).toBe(TOKEN_PROGRAM_ADDRESS);

    // Paid to KORA'S payment address, not to its signer: they are different accounts, and paying the
    // wrong one means Kora never sees its money and declines to co-sign.
    const destAta = await associatedTokenAddress(MINT, PAYMENT_ADDRESS, TOKEN_PROGRAM_ADDRESS);
    expect(accountAddresses(instructions[0]!)).toContain(destAta);
  });

  // Kora is the fee payer, so Kora funds the account it is to be repaid into — the user must not be
  // billed rent in SOL on a rail whose entire premise is that they hold no SOL.
  it("lets Kora fund its own payment ATA when it does not exist yet", async () => {
    const kora = fakeKora();
    const authority = createNoopSigner(address(USER));

    const { instructions } = await buildKoraFeePayment({
      kora,
      rpc: fakeRpc(false),
      txB64: "BASE64TX",
      feeToken: MINT,
      from: USER,
      authority,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      decimals: 6,
    });

    expect(instructions).toHaveLength(2); // create-ATA, then transfer
    expect(instructions[0]!.programAddress).toBe(ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
    // The create-ATA payer slot is Kora's signer, not the user.
    expect(accountAddresses(instructions[0]!)[0]).toBe(KORA_SIGNER);
  });
});
