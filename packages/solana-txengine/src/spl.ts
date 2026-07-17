import type { SolanaRpcClient } from "./rpc.js";
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { address, createNoopSigner, type Instruction, type TransactionSigner } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "./decode.js";

/**
 * Derive the associated token account address for a given mint + owner.
 * @param tokenProgram - base58 SPL token program address; defaults to the classic Token program.
 *   Pass the Token-2022 program address to derive the Token-2022 ATA (which is seeded differently).
 */
export async function associatedTokenAddress(
  mint: string,
  owner: string,
  tokenProgram?: string,
): Promise<string> {
  const [pda] = await findAssociatedTokenPda({
    mint: address(mint),
    owner: address(owner),
    tokenProgram: address(tokenProgram ?? TOKEN_PROGRAM_ADDRESS),
  });
  return pda as string;
}

export async function ataExists(rpc: SolanaRpcClient, ata: string): Promise<boolean> {
  return (await rpc.getAccountInfo(ata)).exists;
}

export async function buildSplTransfer(args: {
  rpc: SolanaRpcClient;
  mint: string;
  from: string;
  to: string;
  amount: bigint;
  payer: string;
  /** The user's kit TransactionSigner. Must be a signer (not a bare address) so that
   *  partiallySignTransactionMessageWithSigners fills the authority slot in fronted. */
  authority: TransactionSigner;
  /**
   * The SPL token program that owns this mint (base58).
   * Defaults to the classic Token program. Pass the Token-2022 program address
   * for Token-2022 mints — ATA derivation, create-ATA, and the transfer
   * instruction will all target the correct program.
   */
  tokenProgram?: string;
  /**
   * Decimal places of the mint. Required for ALL SPL transfers: both the classic Token
   * program and Token-2022 now use `transferChecked`, which encodes the decimals so the
   * token program can verify mint + decimals on-chain.
   */
  decimals?: number;
}): Promise<{ instructions: Instruction[]; createdAta: boolean }> {
  const tokenProgram = args.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
  const isToken2022 = tokenProgram === TOKEN_2022_PROGRAM_ADDRESS;

  const destAta = await associatedTokenAddress(args.mint, args.to, tokenProgram);
  const sourceAta = await associatedTokenAddress(args.mint, args.from, tokenProgram);
  const instructions: Instruction[] = [];
  let createdAta = false;

  if (!(await ataExists(args.rpc, destAta))) {
    instructions.push(
      getCreateAssociatedTokenIdempotentInstruction({
        // payer must be a TransactionSigner; actual signing happens when the tx is assembled.
        payer: createNoopSigner(address(args.payer)),
        owner: address(args.to),
        mint: address(args.mint),
        ata: address(destAta),
        // For Token-2022 mints the ATA program must route the create to the Token-2022 program.
        tokenProgram: isToken2022 ? address(TOKEN_2022_PROGRAM_ADDRESS) : undefined,
      }),
    );
    createdAta = true;
  }

  // The SOURCE account must already exist — we cannot create it, because only its owner can fund it,
  // and a token account that has never received the token simply does not exist on Solana.
  //
  // Without this check the transfer still goes out, and the token program rejects it with
  // `InstructionError: [3, "InvalidAccountData"]` — an index into a transaction the user never
  // assembled (it counts two compute-budget instructions and, on the fronted rail, a fee transfer
  // prepended for them) and a message that names neither the token nor the actual problem. The real
  // problem is nearly always the plainest one: this wallet does not hold that token on this cluster.
  if (!(await ataExists(args.rpc, sourceAta))) {
    throw new Error(
      `no token account for mint ${args.mint} on this wallet (${args.from}) — it has never held this token on this cluster, so there is nothing to transfer from. Fund the wallet with the token first.`,
    );
  }

  // Both classic and Token-2022 use `transferChecked` — it encodes the mint + decimals so the
  // token program verifies them on-chain (strictly safer than a plain Transfer). Encoding the
  // mint is also what lets the /sign consent view enrich the fee line.
  if (args.decimals === undefined) {
    throw new Error("buildSplTransfer: decimals is required for SPL transfers (transferChecked encodes it)");
  }
  instructions.push(
    getTransferCheckedInstruction(
      {
        source: address(sourceAta),
        mint: address(args.mint),
        destination: address(destAta),
        // Pass the signer directly so partiallySignTransactionMessageWithSigners
        // can fill the authority slot (critical for fronted where the user is not the fee payer).
        authority: args.authority,
        amount: args.amount,
        decimals: args.decimals,
      },
      // Classic path uses the default program (Token program); Token-2022 overrides it.
      isToken2022 ? { programAddress: address(TOKEN_2022_PROGRAM_ADDRESS) } : undefined,
    ),
  );

  return { instructions, createdAta };
}
