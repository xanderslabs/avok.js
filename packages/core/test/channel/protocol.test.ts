import { describe, expect, it } from "vitest";
import {
  ENVELOPE_KINDS,
  PROTOCOL_VERSION,
  UnknownProtocolVersionError,
  createErrorReply,
  createRequestEnvelope,
  createSuccessReply,
  decodeReplyEnvelope,
  decodeRequestEnvelope,
  encodeEnvelope,
  parseReplyEnvelope,
  parseRequestEnvelope,
} from "../../src/channel/protocol.js";

const REQUESTER_ORIGIN = "https://dapp.example";

describe("request envelope: round-trip per kind", () => {
  for (const kind of ENVELOPE_KINDS) {
    it(`encodes and decodes a "${kind}" request`, () => {
      const envelope = createRequestEnvelope({
        kind,
        chain: "base",
        payload: { example: kind },
        requesterOrigin: REQUESTER_ORIGIN,
      });

      // Structured-clone transports (postMessage) hand the object straight through.
      expect(parseRequestEnvelope(envelope)).toEqual(envelope);

      // URL-fragment / storage transports need the JSON string form.
      const json = encodeEnvelope(envelope);
      expect(decodeRequestEnvelope(json)).toEqual(envelope);
    });
  }
});

describe("reply envelope: round-trip", () => {
  it("encodes and decodes a success reply", () => {
    const reply = createSuccessReply("req-1", { signature: "0xdeadbeef" });
    expect(parseReplyEnvelope(reply)).toEqual(reply);
    expect(decodeReplyEnvelope(encodeEnvelope(reply))).toEqual(reply);
  });

  it("encodes and decodes an error reply", () => {
    const reply = createErrorReply("req-1", "user_rejected");
    expect(parseReplyEnvelope(reply)).toEqual(reply);
    expect(decodeReplyEnvelope(encodeEnvelope(reply))).toEqual(reply);
  });
});

describe("envelope construction", () => {
  it("stamps the current protocol version and requester origin", () => {
    const envelope = createRequestEnvelope({
      kind: "connect",
      chain: "base",
      payload: {},
      requesterOrigin: REQUESTER_ORIGIN,
    });
    expect(envelope.v).toBe(PROTOCOL_VERSION);
    expect(envelope.requester.origin).toBe(REQUESTER_ORIGIN);
  });

  it("gives every request a fresh id", () => {
    const a = createRequestEnvelope({ kind: "connect", chain: "base", payload: {}, requesterOrigin: REQUESTER_ORIGIN });
    const b = createRequestEnvelope({ kind: "connect", chain: "base", payload: {}, requesterOrigin: REQUESTER_ORIGIN });
    expect(a.id).not.toBe(b.id);
  });
});

describe("version rejection", () => {
  it("rejects an unknown request version", () => {
    const stale = {
      v: 2,
      id: "x",
      kind: "connect",
      chain: "base",
      payload: {},
      requester: { origin: REQUESTER_ORIGIN },
    };
    expect(() => parseRequestEnvelope(stale)).toThrow(UnknownProtocolVersionError);
  });

  it("rejects an unknown reply version", () => {
    const stale = { v: 0, id: "x", ok: true, result: {} };
    expect(() => parseReplyEnvelope(stale)).toThrow(UnknownProtocolVersionError);
  });

  it("rejects an unversioned request JSON string rather than throwing on parse", () => {
    expect(decodeRequestEnvelope(JSON.stringify({ id: "x" }))).toBeNull();
  });
});

describe("malformed shapes are ignored, not thrown, when the version matches", () => {
  it("rejects an unrecognized kind", () => {
    const bad = {
      v: PROTOCOL_VERSION,
      id: "x",
      kind: "not-a-real-kind",
      chain: "base",
      payload: {},
      requester: { origin: REQUESTER_ORIGIN },
    };
    expect(parseRequestEnvelope(bad)).toBeNull();
  });

  it("rejects a missing requester origin", () => {
    const bad = { v: PROTOCOL_VERSION, id: "x", kind: "connect", chain: "base", payload: {}, requester: {} };
    expect(parseRequestEnvelope(bad)).toBeNull();
  });

  it("rejects a reply missing both result and error", () => {
    const bad = { v: PROTOCOL_VERSION, id: "x", ok: true };
    expect(parseReplyEnvelope(bad)).toBeNull();
  });

  it("returns null for a non-object value", () => {
    expect(parseRequestEnvelope("not an envelope")).toBeNull();
    expect(parseRequestEnvelope(null)).toBeNull();
  });
});
