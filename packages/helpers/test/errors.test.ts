import { describe, it, expect } from "vitest";
import { classifySendError } from "../src/errors.js";

describe("classifySendError", () => {
  it("classifies user rejection", () => {
    expect(classifySendError({ name: "NotAllowedError" }).kind).toBe("rejected");
    expect(classifySendError(new Error("User rejected the request")).kind).toBe("rejected");
  });
  it("classifies a cancelled/timed-out passkey (WebAuthn NotAllowedError)", () => {
    // Browser DOMException: name = NotAllowedError, message = prose with no "notallowed" token.
    const domLike = { name: "NotAllowedError", message: "The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/" };
    expect(classifySendError(domLike).kind).toBe("rejected");
    // Even when surfaced as a generic Error carrying only the prose message:
    expect(classifySendError(new Error("The operation either timed out or was not allowed.")).kind).toBe("rejected");
  });
  it("classifies insufficient funds", () => {
    expect(classifySendError(new Error("insufficient funds for gas")).kind).toBe("insufficient-funds");
  });
  it("classifies wrong chain", () => {
    expect(classifySendError(new Error("chain 1 not configured / unsupported chain")).kind).toBe("wrong-chain");
  });
  it("classifies fronted unavailable", () => {
    expect(classifySendError(new Error("paymaster URL not set")).kind).toBe("fronted-unavailable");
    expect(classifySendError(new Error("relayer unavailable")).kind).toBe("fronted-unavailable");
  });
  it("falls back to unknown with the original message", () => {
    const r = classifySendError(new Error("boom"));
    expect(r.kind).toBe("unknown");
    expect(r.message).toContain("boom");
  });
});

describe("a relayer refusal is explained, not buried", () => {
  it("surfaces the relayer's reason instead of the generic 'check the config'", () => {
    const err = new Error("Paymaster refused the transaction: fee_too_low (HTTP 400)");
    const { kind, message } = classifySendError(err);
    expect(kind).toBe("fronted-unavailable");
    expect(message).toMatch(/fee you signed is below/i);
    expect(message).not.toMatch(/check the paymaster/i); // ← the old, useless line
  });

  it("an UNKNOWN reason is still shown verbatim — better than no reason", () => {
    const err = new Error("Paymaster refused the transaction: some_new_reason (HTTP 400)");
    expect(classifySendError(err).message).toMatch(/some_new_reason/);
  });
});
