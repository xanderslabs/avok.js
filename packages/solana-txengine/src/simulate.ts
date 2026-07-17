import { compileTransaction, getBase64EncodedWireTransaction } from "@solana/kit";
import type { SolanaRpcClient } from "./rpc.js";
import type { SimulationResult, DecodedInstruction } from "./types.js";

/** Programs we can name. An error that says "instruction 3" names nothing a person can act on. */
const PROGRAM_NAMES: Record<string, string> = {
  ComputeBudget111111111111111111111111111111: "compute budget",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "open token account",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL token transfer",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "SPL token transfer (Token-2022)",
  "11111111111111111111111111111111": "system transfer",
};

/**
 * Turn `{"InstructionError":["3","InvalidAccountData"]}` into something a human can act on.
 *
 * The index is into the FINAL transaction, which the user never assembled and cannot see: it counts
 * the two compute-budget instructions and, on the fronted rail, the fee transfer that was prepended
 * for them. Reporting the bare index makes the reader reverse-engineer our own assembly order before
 * they can even start debugging.
 */
function annotateInstructionError(rendered: string, programOrder: readonly string[] | undefined): string {
  if (!programOrder?.length) return rendered;
  const m = /"InstructionError":\s*\[\s*"?(\d+)"?/.exec(rendered);
  if (!m) return rendered;
  const idx = Number(m[1]);
  const program = programOrder[idx];
  if (program === undefined) return rendered;
  const name = PROGRAM_NAMES[program] ?? `program ${program}`;
  return `${rendered} — failing instruction #${idx} is the ${name}`;
}

/**
 * Render a simulation error for a human.
 *
 * `JSON.stringify` alone THROWS on this input — the RPC's error objects carry u64s, which the client
 * models as BigInt, and BigInt has no JSON representation. So the moment a Solana simulation actually
 * failed, this line died with "Do not know how to serialize a BigInt" and that crash REPLACED the real
 * failure: the user got a nonsense message about serialization and the true cause never surfaced.
 *
 * An error path that destroys the error is worse than no error path. Never let the reporter outrank
 * the thing it is reporting.
 */
function formatSimError(err: unknown, logs: string[] | null, programOrder?: readonly string[]): string {
  let rendered: string;
  if (typeof err === "string") {
    rendered = err;
  } else {
    try {
      rendered = JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    } catch {
      rendered = String(err);
    }
  }
  // The program logs usually say more than the error enum does — fall back to the last one when the
  // error itself renders to nothing (an empty string, or an object JSON drops entirely).
  if (!rendered) return logs?.at(-1) || "simulation failed";
  return annotateInstructionError(rendered, programOrder);
}

export async function simulateSolana(args: {
  rpc: SolanaRpcClient;
  base64Tx: string;
  decoded?: DecodedInstruction[];
  fee?: SimulationResult["fee"];
  /** Program addresses in FINAL transaction order (compute budget first). Used to name a failing
   *  instruction — see annotateInstructionError. */
  programOrder?: readonly string[];
}): Promise<SimulationResult> {
  const sim = await args.rpc.simulateTransaction(args.base64Tx);
  const success = sim.err == null;
  const error = success ? undefined : formatSimError(sim.err, sim.logs, args.programOrder);
  return {
    success,
    computeUnits: sim.unitsConsumed ?? 0n,
    fee: args.fee,
    decodedInstructions: args.decoded ?? [],
    confidence: "exact",
    error,
  };
}

export async function simulateSolanaMessage(args: {
  rpc: SolanaRpcClient;
  message: unknown;
  decoded?: DecodedInstruction[];
  fee?: SimulationResult["fee"];
}): Promise<SimulationResult> {
  const compiled = compileTransaction(args.message as never);
  const base64Tx = getBase64EncodedWireTransaction(compiled as never);
  // The message already holds the instructions in final order — read the program list off it rather
  // than asking every caller to reconstruct it (and get the compute-budget offset wrong).
  const programOrder = (args.message as { instructions?: readonly { programAddress?: string }[] }).instructions
    ?.map((ix) => ix.programAddress ?? "");
  return simulateSolana({ rpc: args.rpc, base64Tx, decoded: args.decoded, fee: args.fee, ...(programOrder ? { programOrder } : {}) });
}
