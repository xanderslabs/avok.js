/**
 * The vault protocol envelope (TDD §4) — the versioned request/reply shape every transport
 * (popup postMessage, redirect fragment) carries. One page serves every request kind; the envelope
 * is how it knows which.
 *
 * This module owns CONSTRUCTION and PARSING of the envelope only. It does not open a popup, does not
 * post a message, and does not decode a URL fragment — those are `channels/web.ts`, `channels/native.ts`,
 * and `redirect-protocol.ts`. Kinds `create`, `recover`, `guardian-op`, and `device-enroll` are declared
 * here as groundwork for later tasks (vault/simulate, vault/recover, wallet/ D8 enrollment); this module
 * does not yet interpret their payloads.
 */

export const PROTOCOL_VERSION = 1;

export const ENVELOPE_KINDS = [
  "connect",
  "sign-tx",
  "sign-message",
  "create",
  "recover",
  "guardian-op",
  "device-enroll",
] as const;

export type EnvelopeKind = (typeof ENVELOPE_KINDS)[number];

export type RequestEnvelope<TPayload = unknown> = {
  v: typeof PROTOCOL_VERSION;
  id: string;
  kind: EnvelopeKind;
  chain: string;
  payload: TPayload;
  requester: { origin: string };
};

export type ReplyEnvelope<TResult = unknown> =
  | { v: typeof PROTOCOL_VERSION; id: string; ok: true; result: TResult }
  | { v: typeof PROTOCOL_VERSION; id: string; ok: false; error: string };

/** 128 bits of randomness, hex — collision-safe enough to correlate a reply without a server. */
function randomEnvelopeId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Build a request envelope. `id` is generated fresh; callers use it to correlate the reply. */
export function createRequestEnvelope<TPayload>(args: {
  kind: EnvelopeKind;
  chain: string;
  payload: TPayload;
  requesterOrigin: string;
}): RequestEnvelope<TPayload> {
  return {
    v: PROTOCOL_VERSION,
    id: randomEnvelopeId(),
    kind: args.kind,
    chain: args.chain,
    payload: args.payload,
    requester: { origin: args.requesterOrigin },
  };
}

/** Build a success reply, correlated to `id` by the caller. */
export function createSuccessReply<TResult>(id: string, result: TResult): ReplyEnvelope<TResult> {
  return { v: PROTOCOL_VERSION, id, ok: true, result };
}

/** Build an error reply, correlated to `id` by the caller. */
export function createErrorReply(id: string, error: string): ReplyEnvelope<never> {
  return { v: PROTOCOL_VERSION, id, ok: false, error };
}

export class UnknownProtocolVersionError extends Error {
  constructor(readonly received: unknown) {
    super(`Unknown vault protocol version: expected ${PROTOCOL_VERSION}, got ${JSON.stringify(received)}`);
    this.name = "UnknownProtocolVersionError";
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/**
 * Parse an unknown value as a request envelope. Throws `UnknownProtocolVersionError` on a version
 * mismatch (fail loud rather than silently coerce), returns `null` for anything else malformed —
 * matching `channels/web.ts`'s existing pattern of ignoring shapes it does not recognize.
 */
export function parseRequestEnvelope(value: unknown): RequestEnvelope | null {
  if (!isRecord(value)) return null;
  if ("v" in value && value.v !== PROTOCOL_VERSION) throw new UnknownProtocolVersionError(value.v);
  if (value.v !== PROTOCOL_VERSION) return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.kind !== "string" || !(ENVELOPE_KINDS as readonly string[]).includes(value.kind)) return null;
  if (typeof value.chain !== "string") return null;
  if (!("payload" in value)) return null;
  if (!isRecord(value.requester) || typeof value.requester.origin !== "string") return null;
  return value as RequestEnvelope;
}

/** Parse an unknown value as a reply envelope. Same version/shape discipline as {@link parseRequestEnvelope}. */
export function parseReplyEnvelope(value: unknown): ReplyEnvelope | null {
  if (!isRecord(value)) return null;
  if ("v" in value && value.v !== PROTOCOL_VERSION) throw new UnknownProtocolVersionError(value.v);
  if (value.v !== PROTOCOL_VERSION) return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.ok !== "boolean") return null;
  if (value.ok) {
    if (!("result" in value)) return null;
  } else if (typeof value.error !== "string") {
    return null;
  }
  return value as ReplyEnvelope;
}

/** JSON round-trip: for transports (redirect fragment, storage) that need a wire string, not an object. */
export function encodeEnvelope(envelope: RequestEnvelope | ReplyEnvelope): string {
  return JSON.stringify(envelope);
}

/** Inverse of {@link encodeEnvelope}. Throws on unknown version; returns `null` on any other malformed JSON. */
export function decodeRequestEnvelope(json: string): RequestEnvelope | null {
  return parseRequestEnvelope(JSON.parse(json));
}

/** Inverse of {@link encodeEnvelope} for replies. */
export function decodeReplyEnvelope(json: string): ReplyEnvelope | null {
  return parseReplyEnvelope(JSON.parse(json));
}
