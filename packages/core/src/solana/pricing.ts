import { getSolanaTokenProfile } from "@avokjs/contracts";
import type { SolanaRpcClient } from "./rpc.js";
import type { SolanaNativeFeeEstimate } from "./types.js";

/**
 * SELF-PAY pricing only. There is deliberately no sponsored pricer here.
 *
 * There used to be `priceSolanaFee`: an oracle-based converter (lamports × SOL/USD ÷ token/USD × margin)
 * that quoted what the sponsored rail should charge. It is gone with the bespoke relayer (#5). Kora prices
 * its own fee — it simulates the transaction it is being asked to pay for and answers with the total —
 * and a second number derived in parallel here could only ever disagree with it. That disagreement WAS
 * the bug: the relayer re-priced authoritatively, found the client's quote short, and refused
 * (`fee_too_low`). One pricer, one number, and it is the one the user signs.
 */

/** Lamports charged per signature (Solana's fixed base fee). The self-pay wallet signs once: it is
 *  both fee payer and authority. */
export const LAMPORTS_PER_SIGNATURE = 5_000n;

/** The Associated Token Account program. A create-ATA instruction targets it, which is how a batch
 *  announces that somebody is about to fund a new account's rent. */
export const ATA_PROGRAM_ADDRESS = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/**
 * What a SELF-PAY Solana transaction costs the wallet, in SOL.
 *
 * `rent` is kept SEPARATE from the fee on purpose, and it is the reason this function exists at all.
 * A create-ATA is ~2,039,280 lamports against a ~5,000 base fee — some 400× the fee — and on the
 * self-pay rail the USER funds it. Folding it into a "network fee" would misname it; omitting it (the
 * obvious implementation: base + priority) would under-state a send by that same 400×. It is also not
 * really a fee: it is a refundable deposit that funds the RECIPIENT's new token account. The user is
 * entitled to be told all three of those things, so all three are returned.
 */
export async function estimateSolanaNativeFee(args: {
  rpc: SolanaRpcClient;
  cluster: "mainnet" | "devnet";
  instructions: readonly { programAddress: string; accounts?: readonly { address: string }[] }[];
  computeUnitLimit: number;
  computeUnitPrice: bigint;
  /** Signatures the fee payer is charged for. Self-pay: 1 (the wallet signs as payer AND authority). */
  signatures?: bigint;
}): Promise<SolanaNativeFeeEstimate> {
  // Self-pay signs ONCE: the wallet is both fee payer and authority.
  const { baseFee, priorityFee, rent } = await solanaFeeInputs({
    rpc: args.rpc,
    cluster: args.cluster,
    instructions: args.instructions,
    numSignatures: args.signatures ?? 1n,
    computeUnitLimit: args.computeUnitLimit,
    computeUnitPrice: args.computeUnitPrice,
  });
  return { baseFee, priorityFee, rent, lamports: baseFee + priorityFee + rent };
}

/**
 * Total rent for EVERY create-ATA in an instruction list, sized per mint.
 *
 * THE ONE DEFINITION OF THIS NUMBER — and it must never be a constant. The obvious implementation
 * hardcodes 2,039,280 lamports, which is the 165-byte token account's rent and is WRONG for any
 * Token-2022 mint (PYUSD's account is 187 bytes / 2,192,400). The size is per-MINT, so the mint is
 * recovered from the instruction's own accounts by MATCHING a registry mint rather than trusting a
 * positional index.
 *
 * Self-pay only now: it is the user who funds a new account, and this is what tells them so. (Sponsored
 * rent is Kora's problem — it pays it and prices it into its own quote.)
 */
async function rentForCreateAtas(args: {
  rpc: SolanaRpcClient;
  cluster: "mainnet" | "devnet";
  instructions: readonly {
    programAddress: string;
    accounts?: readonly ({ address: string } | string)[];
  }[];
}): Promise<bigint> {
  let total = 0n;
  for (const ix of args.instructions) {
    if (ix.programAddress !== ATA_PROGRAM_ADDRESS) continue;
    total += await rentForOne(args.rpc, args.cluster, ix.accounts ?? []);
  }
  return total;
}

async function rentForOne(
  rpc: SolanaRpcClient,
  cluster: "mainnet" | "devnet",
  accounts: readonly ({ address: string } | string)[],
): Promise<bigint> {
  for (const a of accounts) {
    const addr = typeof a === "string" ? a : a.address;
    const token = getSolanaTokenProfile(cluster, addr);
    if (token) return await rpc.getMinimumBalanceForRentExemption(token.ataSize);
  }
  throw new Error(
    "cannot price create-ATA rent: no registry mint found among the instruction's accounts — the account size (and so the rent someone pays) is mint-specific and must not be guessed",
  );
}

/**
 * The SOL a transaction will actually cost whoever pays for it, as three numbers kept apart: base fee,
 * priority fee, and rent (which is not a fee at all — see `estimateSolanaNativeFee`).
 *
 * `numSignatures` is a real input, not a constant: a transaction is charged per signature, and assuming
 * 1 under-quotes anything signed more than once.
 */
async function solanaFeeInputs(args: {
  rpc: SolanaRpcClient;
  cluster: "mainnet" | "devnet";
  instructions: readonly { programAddress: string; accounts?: readonly ({ address: string } | string)[] }[];
  numSignatures: bigint;
  computeUnitLimit: number | bigint;
  computeUnitPrice: bigint;
}): Promise<{ baseFee: bigint; priorityFee: bigint; rent: bigint }> {
  const baseFee = LAMPORTS_PER_SIGNATURE * args.numSignatures;
  // Solana charges the priority fee on the compute limit REQUESTED, not the units consumed.
  const priorityFee = (BigInt(args.computeUnitLimit) * args.computeUnitPrice) / 1_000_000n;
  const rent = await rentForCreateAtas(args);
  return { baseFee, priorityFee, rent };
}
