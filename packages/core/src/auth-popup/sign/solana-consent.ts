/**
 * solana-consent.ts — Pure Solana consent decoder.
 *
 * Converts compiled Solana message bytes (the unsigned wire format the user signs)
 * into a human-readable SolanaConsentView. No passkey gesture, no RPC calls.
 *
 * Shared decode core: @avokjs/core/decode
 */
import { base64 } from "@scure/base";
import { getSolanaTokenProfile } from "@avokjs/contracts";
import {
  decodeCompiledMessage,
  classifySplTransfer,
  type DecodedIx,
} from "../../solana/decode.js";

// ── Well-known program addresses (protocol constants) ─────────────────────────
// Solana compute-budget program
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
// Solana system program
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
// SPL Associated Token Account program
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SolanaConsentLine {
  programId: string;
  kind: "spl-transfer" | "spl-create-ata" | "compute-budget" | "system-transfer" | "raw";
  /** Present for spl-transfer: security-critical transfer metadata.
   *  symbol/decimals are populated from the registry when a cluster hint is supplied AND the
   *  instruction is a TransferChecked (which encodes a mint); otherwise they are omitted. */
  token?: {
    mint: string;       // "" for plain Transfer (no mint encoded); populated for TransferChecked
    amount: string;     // base-unit value as string (bigint serialised)
    destination: string;
    symbol?: string;
    decimals?: number;
    /** Human-readable amount derived from `amount`/`decimals` (e.g. "1.5"). Set alongside
     *  symbol/decimals during enrichment; never replaces `amount` (base units stay visible). */
    amountDisplay?: string;
  };
  /** Present for kind:"system-transfer": security-critical native SOL transfer metadata.
   *  Surfacing lamports + destination prevents a native-SOL drain rendering as a bare label. */
  native?: {
    lamports: string;   // base-unit value as string (bigint serialised; 1 SOL = 1e9 lamports)
    destination: string;
  };
  /** Present for kind:"raw": base64-encoded instruction data */
  raw?: string;
}

export interface SolanaConsentView {
  /** Passed through from opts.cluster if provided; undefined until S-5 enriches it. */
  cluster?: string;
  feePayer: string;
  instructions: SolanaConsentLine[];
}

// ── System-program native transfer classifier ────────────────────────────────
//
// System Program `Transfer` instruction layout:
//   accounts: [0]=from, [1]=to
//   data:     u32 LE instruction index (Transfer = 2) ‖ u64 LE lamports  (12 bytes)
// Only plain Transfer (index 2) is classified; other system ops (CreateAccount,
// TransferWithSeed, …) return null and render as raw rather than a reassuring label.
const SYSTEM_TRANSFER_INDEX = 2;

function classifySystemTransfer(ix: DecodedIx): { lamports: bigint; destination: string } | null {
  if (ix.programAddress !== SYSTEM_PROGRAM) return null;
  if (ix.data.length < 12) return null;
  const index = ix.data[0]! | (ix.data[1]! << 8) | (ix.data[2]! << 16) | (ix.data[3]! << 24);
  if (index !== SYSTEM_TRANSFER_INDEX) return null;
  const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
  const lamports = view.getBigUint64(4, true);
  return { lamports, destination: ix.accounts[1] ?? "" };
}

// ── Base-unit → human amount formatter ────────────────────────────────────────
//
// Precision-safe, string-based: `amount` may be a very large base-10 integer string that
// overflows Number/parseFloat, so no float math is used. Pads with leading zeros until the
// string is longer than `decimals`, splits into integer/fraction, and strips trailing zeros.
export function formatBaseUnits(amount: string, decimals: number): string {
  if (decimals <= 0) return amount;
  const padded = amount.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

// ── Instruction classifier ────────────────────────────────────────────────────

function lineFor(ix: DecodedIx, cluster?: string): SolanaConsentLine {
  // SPL token Transfer / TransferChecked (classic or Token-2022)
  const transfer = classifySplTransfer(ix);
  if (transfer) {
    const token: NonNullable<SolanaConsentLine["token"]> = {
      mint: transfer.mint,
      amount: transfer.amount.toString(),
      destination: transfer.destination,
    };
    // Enrich with registry symbol/decimals when the cluster is known AND a mint is present
    // (a plain Transfer encodes no mint → transfer.mint === "" → no lookup).
    if ((cluster === "mainnet" || cluster === "devnet") && transfer.mint) {
      const profile = getSolanaTokenProfile(cluster, transfer.mint);
      if (profile) {
        token.symbol = profile.symbol;
        token.decimals = profile.decimals;
        token.amountDisplay = formatBaseUnits(token.amount, profile.decimals);
      }
    }
    return { programId: ix.programAddress, kind: "spl-transfer", token };
  }

  if (ix.programAddress === ATA_PROGRAM) {
    return { programId: ix.programAddress, kind: "spl-create-ata" };
  }
  if (ix.programAddress === COMPUTE_BUDGET) {
    return { programId: ix.programAddress, kind: "compute-budget" };
  }
  if (ix.programAddress === SYSTEM_PROGRAM) {
    const native = classifySystemTransfer(ix);
    if (native) {
      return {
        programId: ix.programAddress,
        kind: "system-transfer",
        native: { lamports: native.lamports.toString(), destination: native.destination },
      };
    }
    // Unrecognised system-program op — surface as raw rather than a reassuring "SOL transfer".
    return { programId: ix.programAddress, kind: "raw", raw: base64.encode(ix.data) };
  }

  return {
    programId: ix.programAddress,
    kind: "raw",
    raw: base64.encode(ix.data),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Decode unsigned compiled Solana message bytes into a human-readable consent view.
 *
 * Pure: no passkey gesture, no RPC calls.
 *
 * @param messageBytes - The compiled message bytes (from compileTransaction().messageBytes).
 * @param opts.cluster - Optional cluster hint ("mainnet"|"devnet"). When present, SPL
 *   TransferChecked lines are enriched with the registry token symbol/decimals; a missing
 *   cluster falls back to the unenriched render (backward-safe).
 */
export function decodeSolanaConsent(
  messageBytes: Uint8Array,
  opts?: { cluster?: string },
): SolanaConsentView {
  const { feePayer, instructions } = decodeCompiledMessage(messageBytes);
  return {
    cluster: opts?.cluster,
    feePayer,
    instructions: instructions.map((ix) => lineFor(ix, opts?.cluster)),
  };
}
