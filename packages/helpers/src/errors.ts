export type SendErrorKind =
  | "rejected"
  | "insufficient-funds"
  | "wrong-chain"
  | "fronted-unavailable"
  | "unknown";

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "name" in err) return String((err as { name: unknown }).name);
  return String(err);
}

// Classification text includes the error's `name` too — a cancelled WebAuthn passkey is a
// DOMException whose `name` is "NotAllowedError" but whose `message` is the prose "The operation
// either timed out or was not allowed…" (no "notallowed" token). Inspecting the name catches it.
function classifyText(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { name?: unknown; message?: unknown };
    return `${String(e.name ?? "")} ${String(e.message ?? "")}`.toLowerCase();
  }
  return String(err).toLowerCase();
}

const FRIENDLY: Record<SendErrorKind, string> = {
  rejected: "Passkey prompt cancelled or timed out.",
  "insufficient-funds": "Not enough balance to cover the amount plus fees.",
  "wrong-chain": "This chain isn't configured for the wallet.",
  "fronted-unavailable": "Fronted (fronted) is unavailable — check the paymaster/relayer + fee-token config.",
  unknown: "Something went wrong.",
};

/**
 * What the RELAYER said, in words a person can act on.
 *
 * The paymaster refuses an intent with a precise machine reason, and it used to be thrown away twice
 * over: the client discarded the 400's JSON body, and this classifier then replaced whatever detail
 * survived with a generic "Fronted is unavailable — check the config". Every fronted failure looked
 * identical and undiagnosable. It is the relayer TELLING US what is wrong; say it.
 */
const RELAYER_REASON: Record<string, string> = {
  fee_too_low: "The fee you signed is below what the relayer now requires — gas prices moved. Try again.",
  no_fee: "The transaction carried no fee payment, so the relayer has nothing to be repaid with.",
  wrong_fee_recipient: "The fee was paid to the wrong address — the app and the relayer disagree on who fronts.",
  unsupported_token: "The relayer does not accept that fee token on this chain.",
  unsupported_chain: "The relayer is not configured for this chain.",
  bad_signature: "The relayer could not verify your signature over this transaction.",
  expired: "The transaction's deadline passed before the relayer got it. Try again.",
  sim_reverted: "The transaction would fail on chain, so the relayer refused to pay for it.",
  fronter_unavailable: "The relayer's own balance is below its safety threshold — the fronter needs topping up.",
  not_fronted: "The relayer only accepts fronted transactions, and this one was not one.",
  rate_limited: "The relayer is rate-limiting this app. Wait and retry.",
  bad_request: "The relayer rejected the shape of the request.",
};

/** `PaymasterRejectedError` formats as "Paymaster refused the transaction: <reason> (HTTP 400)". */
function relayerReason(detail: string): string | undefined {
  const m = /paymaster refused the transaction:\s*([a-z_]+)/i.exec(detail);
  return m?.[1];
}

/**
 * Map a thrown send/sign error into one of the four explicit UI states plus a friendly message.
 * Order matters: rejection is checked before funds so a "user rejected — insufficient" style
 * message still reads as a rejection.
 */
export function classifySendError(err: unknown): { kind: SendErrorKind; message: string } {
  const raw = classifyText(err);
  let kind: SendErrorKind = "unknown";

  if (
    raw.includes("notallowed") ||
    raw.includes("not allowed") ||
    raw.includes("timed out") ||
    raw.includes("rejected") ||
    raw.includes("denied") ||
    raw.includes("cancel")
  ) {
    kind = "rejected";
  } else if (raw.includes("insufficient")) {
    kind = "insufficient-funds";
  } else if (raw.includes("unsupported chain") || raw.includes("not configured") || raw.includes("wrong chain")) {
    kind = "wrong-chain";
  } else if (raw.includes("paymaster") || raw.includes("relayer") || raw.includes("fronted") || raw.includes("fee token")) {
    kind = "fronted-unavailable";
  }

  const detail = messageOf(err);

  // If the relayer told us WHY, say that — never bury it under the generic line. A reason we do not
  // recognise is still shown verbatim: an unknown reason is far more useful than no reason.
  const reason = relayerReason(detail);
  if (reason) {
    return { kind: "fronted-unavailable", message: RELAYER_REASON[reason] ?? `The relayer refused this transaction: ${reason}.` };
  }

  const message = kind === "unknown" ? `${FRIENDLY.unknown} (${detail})` : FRIENDLY[kind];
  return { kind, message };
}
