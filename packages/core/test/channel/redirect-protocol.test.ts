import { describe, expect, it } from "vitest";
import {
  MAX_REDIRECT_PAYLOAD_BYTES,
  RedirectPayloadTooLargeError,
  decodeRequestUrl,
  decodeResultUrl,
  encodeRequestUrl,
  encodeResultUrl,
} from "../../src/channel/redirect-protocol.js";
import { createRequestEnvelope, createSuccessReply } from "../../src/channel/protocol.js";
import type { RequestEnvelope, ReplyEnvelope } from "../../src/channel/protocol.js";

const AUTH_ORIGIN = "https://vault.example";
const REDIRECT_URI = "myapp://avok-callback";

describe("redirect round-trip carries id/kind intact", () => {
  it("request leg: the envelope's id and kind survive encode -> decode", () => {
    const envelope = createRequestEnvelope({
      kind: "sign-tx",
      chain: "base",
      payload: { to: "0x0000000000000000000000000000000000dead" },
      requesterOrigin: "https://dapp.example",
    });

    const url = encodeRequestUrl<RequestEnvelope>({
      authOrigin: AUTH_ORIGIN,
      request: envelope,
      redirectUri: REDIRECT_URI,
    });

    const decoded = decodeRequestUrl<RequestEnvelope>(url);
    expect(decoded).not.toBeNull();
    expect(decoded!.request.id).toBe(envelope.id);
    expect(decoded!.request.kind).toBe(envelope.kind);
    expect(decoded!.request).toEqual(envelope);
    expect(decoded!.redirectUri).toBe(REDIRECT_URI);
  });

  it("result leg: the reply envelope's id survives encode -> decode", () => {
    const reply = createSuccessReply("req-123", { signature: "0xdeadbeef" });

    const url = encodeResultUrl<ReplyEnvelope>({ redirectUri: REDIRECT_URI, result: reply });
    const decoded = decodeResultUrl<ReplyEnvelope>(url);

    expect(decoded).toEqual(reply);
    expect(decoded!.id).toBe(reply.id);
  });

  it("throws RedirectPayloadTooLargeError rather than silently dropping an oversized request", () => {
    const envelope = createRequestEnvelope({
      kind: "sign-tx",
      chain: "base",
      payload: { data: "0x" + "ab".repeat(MAX_REDIRECT_PAYLOAD_BYTES) },
      requesterOrigin: "https://dapp.example",
    });

    expect(() =>
      encodeRequestUrl<RequestEnvelope>({ authOrigin: AUTH_ORIGIN, request: envelope, redirectUri: REDIRECT_URI }),
    ).toThrow(RedirectPayloadTooLargeError);
  });

  it("returns null, not a throw, when the fragment carries no request", () => {
    expect(decodeRequestUrl(`${AUTH_ORIGIN}/`)).toBeNull();
  });
});
