/**
 * The REDIRECT protocol — how a signing request and its result travel when there is no postMessage.
 *
 * The web popup channel talks over postMessage: bidirectional, unlimited in size, and authenticated
 * by the browser. A native in-app browser session (iOS ASWebAuthenticationSession, Android Chrome
 * Custom Tabs) offers none of that. It is ONE SHOT — the app opens a URL, the session runs, and the
 * only thing that comes back is a redirect to a registered callback. So the request has to go out in
 * the URL and the result has to come back in one.
 *
 * BOTH SIDES USE THE FRAGMENT, and that is a security decision rather than a convention. A query
 * string is sent to the server and lands in its access logs, its CDN's logs, and its Referer headers.
 * A signing request contains the transaction a user is about to approve, and a result contains their
 * address and signature. Neither belongs in a log file, and the fragment is never transmitted.
 *
 * SIZE IS BOUNDED, LOUDLY. Two ceilings sit above this one, and they fail in different ways:
 *
 *   - Android's Binder transaction buffer is 1MB and SHARED PROCESS-WIDE, so what is left depends on
 *     every other transaction in flight, not on this request alone. A Custom Tab URL travels as
 *     Intent data across Binder, so this is the limit that bites first. It throws
 *     TransactionTooLargeException, which is at least catchable. Google's own guidance is to keep
 *     such payloads to a few KB.
 *   - Chromium accepts URLs up to 2MB (url::kMaxURLChars) and past that SILENTLY REPLACES them with
 *     an empty, invalid URL — not a truncation, and no error reaches the caller. It looks exactly
 *     like a user cancelling.
 *
 * Apple documents no limit at all, so the iOS ceiling is genuinely unknown to the whole ecosystem.
 * Guessing high would trade a clear error for a silent, unreproducible failure, so the bound here is
 * deliberately conservative and refuses rather than hopes.
 *
 * REQUEST-SIZE LIMIT: `MAX_REDIRECT_PAYLOAD_BYTES` above governs BOTH legs — the outbound request
 * fragment and the inbound result fragment share one ceiling, `encode()` enforces it on whichever is
 * passed through, and `RedirectPayloadTooLargeError` fails loudly rather than truncating silently.
 *
 * RESULT-INTEGRITY ON THE RETURN LEG: a redirect proves nothing about who sent it — see
 * `decodeResultUrl`'s docstring below. This module only PARSES the callback URL; the caller
 * (`channel/authorize-proof.ts` for `connect`, the signature check for `sign-*`) verifies that what
 * came back actually proves what it claims before trusting it.
 *
 * Both `encodeRequestUrl`/`decodeRequestUrl` and `encodeResultUrl`/`decodeResultUrl` are generic over
 * the payload type, defaulting to the legacy `ChannelRequest`/`ChannelResult` shape so existing call
 * sites (`channels/native.ts`) are unaffected. The vault protocol envelope (`./protocol.ts`) is the
 * intended payload going forward: its `id` and `kind` fields travel through this encoding unchanged,
 * which is what lets the app correlate a redirect reply to the request that produced it.
 */
import type { ChannelRequest, ChannelResult } from "./channels/port.js";

/**
 * Conservative ceiling on an encoded payload, in bytes.
 *
 * Chosen from the only documented guidance that exists (Android's "a few KB"), NOT from a measured
 * platform limit — there is no published iOS figure, and the widely-quoted 80,000-character number is
 * unsourced folklore. If a real ceiling is ever measured on device, raise this with the evidence.
 */
export const MAX_REDIRECT_PAYLOAD_BYTES = 4096;

/** Fragment parameter names. Namespaced: the wallet page is a real app and may use its own. */
const REQ_PARAM = "avokReq";
const RES_PARAM = "avokRes";

export class RedirectPayloadTooLargeError extends Error {
  constructor(
    readonly bytes: number,
    readonly limit: number,
  ) {
    super(
      `Signing payload is ${bytes} bytes, over the ${limit}-byte redirect limit. A native in-app ` +
        `browser carries the request in a URL, and an oversized URL is dropped silently rather than ` +
        `rejected — so this fails loudly instead. Reduce the call data, or use a transport that is ` +
        `not URL-bound.`,
    );
    this.name = "RedirectPayloadTooLargeError";
  }
}

function encode(value: unknown, limit: number): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > limit) throw new RedirectPayloadTooLargeError(bytes.length, limit);
  // base64url: a URL fragment must survive percent-encoding rules and copy/paste intact.
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode<T>(encoded: string): T {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** Build the URL the in-app browser opens: the wallet page, with the request in its fragment. */
export function encodeRequestUrl<TRequest = ChannelRequest>(args: {
  originPoint: string;
  request: TRequest;
  /** Where the wallet should send the result. The wallet echoes it; it is not trusted as authority. */
  redirectUri: string;
  limit?: number;
}): string {
  const url = new URL(args.originPoint);
  const payload = encode(
    { request: args.request, redirectUri: args.redirectUri },
    args.limit ?? MAX_REDIRECT_PAYLOAD_BYTES,
  );
  url.hash = `${REQ_PARAM}=${payload}`;
  return url.toString();
}

/** Wallet side: read the request out of `location.hash`. Returns null when there is none. */
export function decodeRequestUrl<TRequest = ChannelRequest>(
  href: string,
): { request: TRequest; redirectUri: string } | null {
  const hash = new URL(href).hash.replace(/^#/, "");
  const encoded = new URLSearchParams(hash).get(REQ_PARAM);
  if (!encoded) return null;
  return decode<{ request: TRequest; redirectUri: string }>(encoded);
}

/** Wallet side: build the redirect that carries the result home. */
export function encodeResultUrl<TResult = ChannelResult>(args: {
  redirectUri: string;
  result: TResult;
  limit?: number;
}): string {
  const url = new URL(args.redirectUri);
  url.hash = `${RES_PARAM}=${encode(args.result, args.limit ?? MAX_REDIRECT_PAYLOAD_BYTES)}`;
  return url.toString();
}

/**
 * App side: read the result out of the callback URL.
 *
 * This carries NO authority. Anything able to steer the browser session can redirect here, so the
 * result is only believable because of what is inside it — a `sign` result is checked against the
 * payload it claims to sign, and an `authorize` result carries a signature over the caller's nonce
 * (channel/authorize-proof.ts). Parsing is not verification.
 */
export function decodeResultUrl<TResult = ChannelResult>(href: string): TResult | null {
  const hash = new URL(href).hash.replace(/^#/, "");
  const encoded = new URLSearchParams(hash).get(RES_PARAM);
  if (!encoded) return null;
  return decode<TResult>(encoded);
}
