import { formatEther } from "viem";
import type { SignConsent, ConsentView, ConsentLine } from "./consent.js";
import type { SolanaConsentView } from "./solana-consent.js";

// An approval at/above this base-unit amount is treated as effectively unlimited.
// 2^255 (~5.8e76) sits far above any real approval (1e27 = a 1B-token approval at
// 18 decimals) yet catches the common 2^256-1 and 2^255 "unlimited" encodings.
const UNLIMITED_THRESHOLD = 2n ** 255n;

// chainId → display name. The id is always shown too, so this is convenience, not trust.
const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum", 10: "Optimism", 8453: "Base", 42161: "Arbitrum", 56: "BNB Chain", 5042002: "Arc",
};
function chainLabel(id: number): string {
  const name = CHAIN_NAMES[id];
  return name ? `${name} (${id})` : `chain ${id}`;
}

// Native gas symbol per chain (Arc's native gas token is USDC; BSC is BNB; else ETH).
const NATIVE_SYMBOLS: Record<number, string> = { 56: "BNB", 5042002: "USDC" };
function nativeSymbol(id: number): string {
  return NATIVE_SYMBOLS[id] ?? "ETH";
}

function evmCallLines(chainId: number, line: ConsentLine): string[] {
  if (line.kind === "erc20-transfer" && line.token) {
    const t = line.token;
    // Registered token → human-readable; unregistered → base units + token address (never hidden).
    if (t.symbol && t.amount !== undefined) {
      return [`Send ${t.amount} ${t.symbol} to ${t.counterparty}`];
    }
    return [`⚠ Send ${t.baseUnits} base units of token ${line.to} (unknown token) to ${t.counterparty}`];
  }
  if (line.kind === "erc20-approve" && line.token) {
    const t = line.token;
    const unlimited = BigInt(t.baseUnits) >= UNLIMITED_THRESHOLD;
    const base =
      t.symbol && t.amount !== undefined
        ? `Approve ${t.counterparty} to spend ${t.amount} ${t.symbol}`
        : `⚠ Approve ${t.counterparty} to spend ${t.baseUnits} base units of token ${line.to} (unknown token)`;
    return [unlimited ? `⚠ ${base} — UNLIMITED` : base];
  }
  if (line.kind === "native") {
    return [`Send ${formatEther(BigInt(line.valueWei))} ${nativeSymbol(chainId)} to ${line.to}`];
  }
  // raw / unrecognized — never hidden; full calldata shown.
  return [`⚠ Unrecognized call to ${line.to} — value ${line.valueWei} wei, data ${line.raw}`];
}

/** SPONSORED: an exact fee, committed to the batch and covered by this signature. */
function feeLine(chainId: number, fee: ConsentLine): string {
  if (fee.token && fee.token.symbol && fee.token.amount !== undefined) {
    return `Network fee: ${fee.token.amount} ${fee.token.symbol} (repaid to the paymaster)`;
  }
  if (fee.token) return `⚠ Network fee: ${fee.token.baseUnits} base units of token ${fee.to} (unknown token)`;
  if (fee.kind === "native") return `Network fee: ${formatEther(BigInt(fee.valueWei))} ${nativeSymbol(chainId)}`;
  return `Network fee: ${fee.valueWei} wei to ${fee.to}`;
}

/** SELF-PAY: no fee is committed, so there is no exact number to show — but the signature still caps
 *  what the transaction may cost. State the cap, and state that it is a cap. */
function maxFeeLine(chainId: number, maxFeeWei: bigint): string {
  return `Network fee: paid by you in ${nativeSymbol(chainId)} — at most ${formatEther(maxFeeWei)}, and only what the transaction actually uses`;
}

function evmViewLines(view: ConsentView): string[] {
  const lines = [`Chain ${chainLabel(view.chainId)}`];
  for (const call of view.calls) lines.push(...evmCallLines(view.chainId, call));
  if (view.fee) lines.push(feeLine(view.chainId, view.fee));
  else if (view.maxFeeWei !== undefined) lines.push(maxFeeLine(view.chainId, view.maxFeeWei));
  return lines;
}

/** Lamports → SOL. 9 decimals, trailing zeros trimmed. "100000000 lamports" is a machine number. */
function formatSol(lamports: string | bigint): string {
  const n = BigInt(lamports);
  const whole = n / 1_000_000_000n;
  const frac = (n % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function solanaViewLines(view: SolanaConsentView): string[] {
  const lines = ["Solana transaction", `Fee payer: ${view.feePayer}`];
  // The compute-budget instructions (limit + price) are protocol plumbing the user did not ask for and
  // cannot act on. They were rendered as TWO identical "Compute budget" lines, which is noise on the
  // one screen that must be read — and noise is how a consent screen teaches people to stop reading.
  // Collapse them to a single line, and only when something else is on screen to give them context.
  let computeBudget = false;
  for (const ix of view.instructions) {
    if (ix.kind === "spl-transfer" && ix.token) {
      const t = ix.token;
      if (t.symbol && t.amountDisplay) {
        lines.push(`Token transfer: ${t.amountDisplay} ${t.symbol} → ${t.destination}`);
      } else {
        lines.push(`Token transfer: ${t.amount} of ${t.mint ? t.mint : "(mint unavailable)"} → ${t.destination}`);
      }
    } else if (ix.kind === "spl-create-ata") {
      lines.push("Create associated token account (required to receive this token)");
    } else if (ix.kind === "compute-budget") {
      computeBudget = true;
    } else if (ix.kind === "system-transfer" && ix.native) {
      // "100000000 lamports" is a machine number. Nobody consents to lamports.
      lines.push(`Send ${formatSol(ix.native.lamports)} SOL to ${ix.native.destination}`);
    } else if (ix.kind === "system-transfer") {
      lines.push("SOL transfer (amount unavailable)");
    } else {
      lines.push(`⚠ Unrecognized instruction (${ix.programId})`);
    }
  }
  // One line, last, and only alongside the operations it budgets for.
  if (computeBudget) lines.push("Compute budget (network fee settings)");
  return lines;
}

// SIWE field render order; absent keys skipped. resources handled separately.
const SIWE_ORDER: [label: string, key: string][] = [
  ["Domain", "domain"], ["URI", "uri"], ["Statement", "statement"], ["Chain", "chainId"],
  ["Nonce", "nonce"], ["Issued", "issuedAt"], ["Expires", "expirationTime"], ["Not before", "notBefore"],
  ["Scheme", "scheme"], ["Request id", "requestId"],
];

/** Pure: turns a decoded consent into plain human-readable lines. No gesture, no I/O. */
export function formatConsentDisplay(consent: SignConsent): string[] {
  switch (consent.op) {
    case "signMessage":
      return ["Sign message:", consent.message];
    case "signTypedData":
      return evmViewLines(consent.view);
    case "signTransaction":
      // `fee` is populated for a sponsored batch — the fee the user pays is part of what they are
      // approving, so it must reach the screen, not be dropped on the way here.
      return evmViewLines({
        chainId: consent.chainId,
        calls: consent.calls,
        ...(consent.fee ? { fee: consent.fee } : {}),
        ...(consent.maxFeeWei !== undefined ? { maxFeeWei: consent.maxFeeWei } : {}),
      });
    case "signAuthorization":
      return [`⚠ Authorize account upgrade to ${consent.implementation} on ${chainLabel(consent.chainId)}`];

    // COMPOSITE ops. When `delegation` is set, this ONE approval also installs the 7702 delegate —
    // it must be on screen, or the user upgrades their account without being told.
    case "signSend":
      return [
        ...(consent.delegation
          ? [`⚠ Authorize account upgrade to ${consent.delegation} on ${chainLabel(consent.chainId)}`]
          : []),
        ...evmViewLines({
          chainId: consent.chainId,
          calls: consent.calls,
          ...(consent.fee ? { fee: consent.fee } : {}),
          ...(consent.maxFeeWei !== undefined ? { maxFeeWei: consent.maxFeeWei } : {}),
        }),
      ];

    case "signSponsored":
      return [
        ...(consent.delegation ? [`⚠ Authorize account upgrade to ${consent.delegation}`] : []),
        ...evmViewLines(consent.view),
      ];

    case "signUserOp":
      return [
        ...(consent.delegation
          ? [`⚠ Authorize account upgrade to ${consent.delegation} on ${chainLabel(consent.chainId)}`]
          : []),
        ...evmViewLines({ chainId: consent.chainId, calls: consent.calls }),
      ];
    case "signSiwe": {
      const f = consent.fields;
      const lines: string[] = [];
      for (const [label, key] of SIWE_ORDER) if (f[key] !== undefined) lines.push(`${label}: ${f[key]}`);
      if (f.resources !== undefined) {
        lines.push("Resources:");
        for (const r of f.resources.split("\n")) lines.push(r);
      }
      return lines;
    }
    case "signSolanaTransaction":
      return solanaViewLines(consent.view);
    case "signSolanaMessage":
      return ["Sign message:", consent.message];
    default: {
      const _exhaustive: never = consent;
      throw new Error(`Unknown consent op: ${(_exhaustive as { op: string }).op}`);
    }
  }
}
