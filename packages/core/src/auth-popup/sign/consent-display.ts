import { formatEther, formatUnits } from "viem";
import { getTokenProfile } from "@avokjs/contracts";
import type { SignConsent, ConsentView, ConsentLine } from "./consent.js";
import { dangerousPrimaryType, isUnlimitedAmount, type Severity } from "./danger.js";
import type { AssetDelta, ApprovalGrant, SimulationResult } from "../../vault/simulate/index.js";

/**
 * One line of the approval screen, with how alarming it is.
 *
 * Severity is STRUCTURAL rather than a character inside the text. It used to be a "⚠" prefix, which
 * meant the view could only render warnings, never rank or gate on them: to know whether a request
 * was dangerous you had to search rendered strings for a glyph. A screen that must decide whether to
 * demand a deliberate confirmation cannot be parsing its own output to find out.
 */
export interface ConsentDisplayLine {
  text: string;
  severity: Severity;
}

const info = (text: string): ConsentDisplayLine => ({ text, severity: "info" });
const caution = (text: string): ConsentDisplayLine => ({ text, severity: "caution" });
const danger = (text: string): ConsentDisplayLine => ({ text, severity: "danger" });

const RANK: Record<Severity, number> = { info: 0, caution: 1, danger: 2 };

/** The worst thing on the screen, which is what the screen as a whole must be treated as. */
export function highestSeverity(lines: ConsentDisplayLine[]): Severity {
  return lines.reduce<Severity>((worst, l) => (RANK[l.severity] > RANK[worst] ? l.severity : worst), "info");
}

/** The text alone, for callers that only need to read it. */
export function displayText(lines: ConsentDisplayLine[]): string[] {
  return lines.map((l) => l.text);
}

// chainId → display name. The id is always shown too, so this is convenience, not trust.
const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  8453: "Base",
  42161: "Arbitrum",
  56: "BNB Chain",
  5042002: "Arc",
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

function evmCallLines(chainId: number, line: ConsentLine): ConsentDisplayLine[] {
  if (line.kind === "erc20-transfer" && line.token) {
    const t = line.token;
    // Registered token → human-readable; unregistered → base units + token address (never hidden).
    if (t.symbol && t.amount !== undefined) {
      return [info(`Send ${t.amount} ${t.symbol} to ${t.counterparty}`)];
    }
    return [caution(`Send ${t.baseUnits} base units of token ${line.to} (unknown token) to ${t.counterparty}`)];
  }
  if (line.kind === "erc20-approve" && line.token) {
    const t = line.token;
    const known = t.symbol && t.amount !== undefined;
    const base = known
      ? `Approve ${t.counterparty} to spend ${t.amount} ${t.symbol}`
      : `Approve ${t.counterparty} to spend ${t.baseUnits} base units of token ${line.to} (unknown token)`;
    if (isUnlimitedAmount(t.baseUnits)) return [danger(`${base} — UNLIMITED`)];
    return [known ? info(base) : caution(base)];
  }
  // increaseAllowance grants exactly what approve does, so it reads the same way.
  if (line.kind === "erc20-increase-allowance" && line.token) {
    const t = line.token;
    const known = t.symbol && t.amount !== undefined;
    const base = known
      ? `Increase ${t.counterparty}'s allowance by ${t.amount} ${t.symbol}`
      : `Increase ${t.counterparty}'s allowance by ${t.baseUnits} base units of token ${line.to} (unknown token)`;
    if (isUnlimitedAmount(t.baseUnits)) return [danger(`${base} — UNLIMITED`)];
    return [known ? info(base) : caution(base)];
  }
  // transferFrom moves tokens FROM an address that may not be the signer, which is the whole point
  // of naming both ends. Showing only the destination would hide whose tokens are moving.
  if (line.kind === "erc20-transfer-from" && line.token) {
    const t = line.token;
    const amount =
      t.symbol && t.amount !== undefined
        ? `${t.amount} ${t.symbol}`
        : `${t.baseUnits} base units of token ${line.to} (unknown token)`;
    return [(t.symbol ? info : caution)(`Move ${amount} from ${t.from} to ${t.counterparty}`)];
  }
  // setApprovalForAll is the broadest grant in common use, and revoking it is the safe direction.
  // The two read differently on purpose: one is a warning, the other is reassurance.
  if (line.kind === "erc721-approve-all" && line.token) {
    const t = line.token;
    return t.approved
      ? [danger(`Approve ${t.counterparty} to transfer ALL of your tokens in collection ${line.to}`)]
      : [info(`Revoke ${t.counterparty}'s approval for all tokens in collection ${line.to}`)];
  }
  if (line.kind === "native") {
    return [info(`Send ${formatEther(BigInt(line.valueWei))} ${nativeSymbol(chainId)} to ${line.to}`)];
  }
  // raw / unrecognized — never hidden; full calldata shown. NOT knowing is itself the warning.
  return [caution(`Unrecognized call to ${line.to} — value ${line.valueWei} wei, data ${line.raw}`)];
}

/** SPONSORED: an exact fee, committed to the batch and covered by this signature. */
function feeLine(chainId: number, fee: ConsentLine): ConsentDisplayLine {
  if (fee.token && fee.token.symbol && fee.token.amount !== undefined) {
    return info(`Network fee: ${fee.token.amount} ${fee.token.symbol} (repaid to the paymaster)`);
  }
  if (fee.token) return caution(`Network fee: ${fee.token.baseUnits} base units of token ${fee.to} (unknown token)`);
  if (fee.kind === "native") return info(`Network fee: ${formatEther(BigInt(fee.valueWei))} ${nativeSymbol(chainId)}`);
  return info(`Network fee: ${fee.valueWei} wei to ${fee.to}`);
}

/** NATIVE-GAS: no fee is committed, so there is no exact number to show — but the signature still caps
 *  what the transaction may cost. State the cap, and state that it is a cap. */
function maxFeeLine(chainId: number, maxFeeWei: bigint): ConsentDisplayLine {
  return info(
    `Network fee: paid by you in ${nativeSymbol(chainId)} — at most ${formatEther(maxFeeWei)}, and only what the transaction actually uses`,
  );
}

function evmViewLines(view: ConsentView): ConsentDisplayLine[] {
  const lines = [info(`Chain ${chainLabel(view.chainId)}`)];
  for (const call of view.calls) lines.push(...evmCallLines(view.chainId, call));
  if (view.fee) lines.push(feeLine(view.chainId, view.fee));
  else if (view.maxFeeWei !== undefined) lines.push(maxFeeLine(view.chainId, view.maxFeeWei));
  return lines;
}

// SIWE field render order; absent keys skipped. resources handled separately.
const SIWE_ORDER: [label: string, key: string][] = [
  ["Domain", "domain"],
  ["URI", "uri"],
  ["Statement", "statement"],
  ["Chain", "chainId"],
  ["Nonce", "nonce"],
  ["Issued", "issuedAt"],
  ["Expires", "expirationTime"],
  ["Not before", "notBefore"],
  ["Scheme", "scheme"],
  ["Request id", "requestId"],
];

/** Pure: turns a decoded consent into plain human-readable lines. No gesture, no I/O. */
export function formatConsentDisplay(consent: SignConsent): ConsentDisplayLine[] {
  switch (consent.op) {
    case "signMessage":
      return [info("Sign message:"), info(consent.message)];
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
      return [danger(`Authorize account upgrade to ${consent.implementation} on ${chainLabel(consent.chainId)}`)];

    // COMPOSITE ops. When `delegation` is set, this ONE approval also installs the 7702 delegate —
    // it must be on screen, or the user upgrades their account without being told.
    case "signSend":
      return [
        ...(consent.delegation
          ? [danger(`Authorize account upgrade to ${consent.delegation} on ${chainLabel(consent.chainId)}`)]
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
        ...(consent.delegation ? [danger(`Authorize account upgrade to ${consent.delegation}`)] : []),
        ...evmViewLines(consent.view),
      ];

    case "signUserOp":
      return [
        ...(consent.delegation
          ? [danger(`Authorize account upgrade to ${consent.delegation} on ${chainLabel(consent.chainId)}`)]
          : []),
        ...evmViewLines({ chainId: consent.chainId, calls: consent.calls }),
      ];
    case "signSiwe": {
      const f = consent.fields;
      const lines: ConsentDisplayLine[] = [];
      for (const [label, key] of SIWE_ORDER) if (f[key] !== undefined) lines.push(info(`${label}: ${f[key]}`));
      if (f.resources !== undefined) {
        lines.push(info("Resources:"));
        for (const r of f.resources.split("\n")) lines.push(info(r));
      }
      return lines;
    }
    case "signTypedDataGeneric": {
      const v = consent.view;
      // A primaryType that grants spending by signature alone is the whole risk of this screen, so
      // it leads, at danger, before any field.
      const reason = dangerousPrimaryType(v.primaryType);
      const lines: ConsentDisplayLine[] = reason ? [danger(reason)] : [];
      lines.push(info("Sign structured data"), info(`Type: ${v.primaryType}`));
      if (v.domain.name) lines.push(info(`From: ${v.domain.name}${v.domain.version ? ` v${v.domain.version}` : ""}`));
      if (v.domain.chainId !== undefined) lines.push(info(`Chain ${chainLabel(v.domain.chainId)}`));
      if (v.domain.verifyingContract) lines.push(info(`Contract: ${v.domain.verifyingContract}`));
      lines.push(info(""));
      // An unlimited amount hiding in a field is the same grant as an unlimited approve.
      for (const f of v.fields) lines.push((isUnlimitedAmount(f.value) ? danger : info)(`${f.label}: ${f.value}`));
      return lines;
    }
    default: {
      const _exhaustive: never = consent;
      throw new Error(`Unknown consent op: ${(_exhaustive as { op: string }).op}`);
    }
  }
}

// ── Simulation rows (TDD §5 step 2) ─────────────────────────────────────────────
//
// Purely a rendering layer over `vault/simulate`'s output — it does no RPC work itself. Callers
// append these lines to whatever `formatConsentDisplay` already produced for the same request; the
// decode-only lines above are UNCHANGED by simulation being available or not, per TDD §5's "decode
// step unchanged" rule. Wiring an actual `simulateRequest` call into the live signing ceremony needs
// an RPC client the Vault does not have yet (its CSP is still `connect-src 'none'` — a later task
// pins it to the operator's configured RPC set); until then this is tested against `SimulationResult`
// fixtures rather than a live popup.

function assetDeltaLine(chainId: number, delta: AssetDelta): ConsentDisplayLine {
  const verb = delta.direction === "out" ? "You send" : "You receive";
  if (delta.kind === "native") {
    return info(`${verb} ${formatEther(delta.amount)} ${nativeSymbol(chainId)}`);
  }
  if (delta.kind === "erc721") {
    return info(`${verb} NFT #${delta.tokenId} of collection ${delta.token}`);
  }
  if (delta.kind === "erc1155") {
    return info(`${verb} ${delta.amount} of token #${delta.tokenId} in collection ${delta.token}`);
  }
  // erc20
  const profile = delta.token ? getTokenProfile(chainId, delta.token) : undefined;
  if (profile) {
    return info(`${verb} ${formatUnits(delta.amount, profile.decimals)} ${profile.symbol}`);
  }
  return caution(`${verb} ${delta.amount} base units of token ${delta.token} (unknown token)`);
}

function approvalGrantLine(chainId: number, grant: ApprovalGrant): ConsentDisplayLine {
  if (grant.kind === "erc721-all") {
    return grant.approved
      ? danger(`Approval granted: ${grant.spender} may transfer ALL of your tokens in collection ${grant.token}`)
      : info(`Approval revoked: ${grant.spender} can no longer transfer tokens in collection ${grant.token}`);
  }
  const profile = getTokenProfile(chainId, grant.token);
  const amount = profile
    ? `${formatUnits(grant.amount, profile.decimals)} ${profile.symbol}`
    : `${grant.amount} base units of token ${grant.token}`;
  const base = `Approval granted: ${grant.spender} may spend ${amount}`;
  return grant.unlimited ? danger(`${base} — UNLIMITED`) : info(base);
}

/**
 * Turn a `SimulationResult` into consent lines: send/receive rows for every asset delta, a line per
 * approval grant, and the "unsimulated" / revert badges TDD §5 calls for. Returns `[]` for
 * `"unsimulated"` deliberately — callers fall back to the decode-only lines `formatConsentDisplay`
 * already produced, they do not lose the row, so there is nothing additional to render here beyond
 * the caution badge.
 */
export function simulationDisplayLines(result: SimulationResult, chainId: number): ConsentDisplayLine[] {
  if (result.status === "unsimulated") {
    return [caution("Not simulated — the details above are decoded from the request, not verified on chain")];
  }
  if (result.status === "reverted") {
    return [danger(`This transaction would fail on chain: ${result.revert?.reason ?? "no reason given"}`)];
  }
  return [
    ...result.deltas.map((d) => assetDeltaLine(chainId, d)),
    ...result.approvals.map((a) => approvalGrantLine(chainId, a)),
  ];
}
