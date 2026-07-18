/**
 * decode.ts — shared compiled-message decode core.
 *
 * Extracts the chain-truth decode (compiled message bytes → feePayer + instructions)
 * and a shared SPL-transfer classifier so the origin consent view and the relayer
 * fee-matcher read the SAME bytes with identical semantics.
 *
 * Exported as the subpath @avokjs/solana-txengine/decode — builder-free,
 * no RPC calls, pure decode.
 *
 * Decode chain:
 *   getCompiledTransactionMessageDecoder().decode(messageBytes) → compiled
 *   decompileTransactionMessage(compiled)  → { feePayer: {address}, instructions }
 *
 * SPL Transfer accounts: [0]=source, [1]=destination, [2]=authority
 * SPL TransferChecked accounts: [0]=source, [1]=mint, [2]=destination, [3]=authority
 */
import { getCompiledTransactionMessageDecoder, decompileTransactionMessage } from "@solana/kit";
import {
  identifyTokenInstruction,
  getTransferInstructionDataDecoder,
  getTransferCheckedInstructionDataDecoder,
  TOKEN_PROGRAM_ADDRESS,
  TRANSFER_DISCRIMINATOR,
  TRANSFER_CHECKED_DISCRIMINATOR,
} from "@solana-program/token";

/** Token-2022 program address (hardcoded; @solana-program/token does not export it). */
export const TOKEN_2022_PROGRAM_ADDRESS = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export interface DecodedIx {
  programAddress: string;
  accounts: string[];
  data: Uint8Array;
}

/**
 * Decode the UNSIGNED compiled message bytes (the exact bytes the user signs via toKitSigner)
 * into fee payer + flat instruction list.
 */
export function decodeCompiledMessage(messageBytes: Uint8Array): { feePayer: string; instructions: DecodedIx[] } {
  const compiled = getCompiledTransactionMessageDecoder().decode(messageBytes);
  // Reject Address Lookup Table (v0) messages. Their instruction accounts are indices into
  // on-chain lookup tables that CANNOT be resolved from the message bytes alone — decompiling
  // without fetching the tables would yield missing/placeholder addresses, so both the consent
  // view and the relayer fee-matcher could misread the real destination. Avok's own builder never
  // emits lookups, so this only rejects externally-supplied (e.g. shared-origin) messages that would
  // otherwise be signed/fee-matched blind. Fail loud rather than decode a message we can't trust.
  const lookups = (compiled as { addressTableLookups?: readonly unknown[] }).addressTableLookups;
  if (lookups && lookups.length > 0) {
    throw new Error(
      "Solana message uses Address Lookup Tables; refusing to decode — accounts cannot be resolved from the message bytes alone (consent/fee-matching would be blind)",
    );
  }
  const message = decompileTransactionMessage(compiled as never);
  const feePayer = (message.feePayer as { address: string }).address;
  const raw = message.instructions as unknown as {
    programAddress: string;
    accounts?: { address: string }[];
    data?: Uint8Array;
  }[];
  const instructions: DecodedIx[] = raw.map((ix) => ({
    programAddress: String(ix.programAddress),
    accounts: (ix.accounts ?? []).map((a) => String(a.address)),
    data: ix.data ?? new Uint8Array(),
  }));
  return { feePayer, instructions };
}

const SPL_PROGRAMS = new Set<string>([TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS]);

/**
 * Classify an instruction as an SPL token Transfer or TransferChecked (on classic SPL or
 * Token-2022), or return null if the instruction is not a recognised token transfer.
 *
 * Shared by the origin's consent view and the relayer's fee matcher so that transfer amounts
 * and destinations agree without duplication.
 */
export function classifySplTransfer(
  ix: DecodedIx,
): { kind: "transfer" | "transferChecked"; source: string; destination: string; mint: string; amount: bigint } | null {
  if (!SPL_PROGRAMS.has(ix.programAddress)) return null;

  const minimal = {
    programAddress: ix.programAddress,
    accounts: ix.accounts.map((a) => ({ address: a })),
    data: ix.data,
  };

  let disc: number;
  try {
    disc = identifyTokenInstruction(minimal as never);
  } catch {
    return null;
  }

  if (disc === TRANSFER_DISCRIMINATOR) {
    // accounts: [0]=source, [1]=destination, [2]=authority
    try {
      const { amount } = getTransferInstructionDataDecoder().decode(ix.data) as { amount: bigint };
      return {
        kind: "transfer",
        source: ix.accounts[0] ?? "",
        destination: ix.accounts[1] ?? "",
        mint: "", // plain Transfer does not encode the mint
        amount,
      };
    } catch {
      return null;
    }
  }

  if (disc === TRANSFER_CHECKED_DISCRIMINATOR) {
    // accounts: [0]=source, [1]=mint, [2]=destination, [3]=authority
    try {
      const { amount } = getTransferCheckedInstructionDataDecoder().decode(ix.data) as { amount: bigint };
      return {
        kind: "transferChecked",
        source: ix.accounts[0] ?? "",
        destination: ix.accounts[2] ?? "",
        mint: ix.accounts[1] ?? "",
        amount,
      };
    } catch {
      return null;
    }
  }

  return null;
}
