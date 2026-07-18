import type { Instruction, TransactionSigner } from "@solana/kit";
import { buildSplTransfer } from "./spl.js";
import type { KoraClient, KoraFeeQuote } from "./kora.js";
import type { SolanaRpcClient } from "./rpc.js";

/**
 * Kora will only co-sign a transaction that PAYS it: an SPL transfer of exactly `fee_in_token` to the
 * quoted `payment_address`. This builds that payment — the Solana analogue of the EVM paymaster's
 * ERC-20 charge: bounded, quoted before the gesture, and committed into the very bytes the user signs
 * (sign-what-you-saw).
 *
 * Priced against the REAL transaction, never a stub: Kora simulates what it is being asked to pay for,
 * so a quote taken over different bytes is a quote for a different transaction.
 */
export async function buildKoraFeePayment(args: {
  kora: KoraClient;
  rpc: SolanaRpcClient;
  /** The base64 tx to price — the user's instructions + Kora's feePayer + blockhash, pre-fee. */
  txB64: string;
  feeToken: string;
  from: string;
  authority: TransactionSigner;
  tokenProgram: string;
  decimals: number;
}): Promise<{ instructions: Instruction[]; quote: KoraFeeQuote }> {
  const quote = await args.kora.estimateTransactionFee(args.txB64, args.feeToken);
  const { instructions } = await buildSplTransfer({
    rpc: args.rpc,
    mint: args.feeToken,
    from: args.from,
    to: quote.paymentAddress,
    amount: quote.feeInToken,
    // Kora is the fee payer, so Kora funds the account it is repaid into. Billing the user rent in SOL
    // would defeat the whole point of a rail for users who hold none.
    payer: quote.signerPubkey,
    authority: args.authority,
    tokenProgram: args.tokenProgram,
    decimals: args.decimals,
  });
  return { instructions, quote };
}
