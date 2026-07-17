import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SIGN_TSX = readFileSync(resolve(process.cwd(), "app", "src", "sign.tsx"), "utf8");

describe("the sign popup is self-contained (#8)", () => {
  it("makes NO network call at all", () => {
    // WHY: the popup's only fetch was POST /sign/consent — a token-gated DECODE of a stateless
    // pure function ("required even though decodeSignConsent is stateless — it gates the decoder
    // against unauthenticated probing"). With no token it has no job, and with no fetch the page
    // is static-hostable. This is also what lets connect-src drop to 'none'.
    expect(SIGN_TSX).not.toMatch(/\bfetch\s*\(/);
  });

  it("decodes and formats in-bundle", () => {
    expect(SIGN_TSX).toMatch(/decodeSignConsent/);
    // The endpoint returned formatConsentDisplay(decodeSignConsent(request)) — BOTH halves move.
    expect(SIGN_TSX).toMatch(/formatConsentDisplay/);
  });

  it("takes credentialId from the REQUEST, not from a token", () => {
    // WHY: /sign/consent returned { display, credentialId }, and credentialId came from the access
    // token's claims. Without it the browser cannot constrain the assertion and the user is asked
    // to pick a passkey on EVERY signature. It rehomes onto the sign request (the app holds it in
    // its SharedAccount, which already carried credentialId?).
    // Match CODE, not prose: the comment explaining the removal legitimately says "sessionId".
    const code = SIGN_TSX.split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");
    expect(code).not.toMatch(/sessionId/);
    expect(code).toMatch(/credentialId/);
  });

  it("still signs in-page via performSign", () => {
    // WHY: guard the money path. performSign was ALREADY browser-side; #8 must not disturb it.
    expect(SIGN_TSX).toMatch(/performSign/);
  });

  it("still refuses to enable Approve on a failed decode", () => {
    // WHY: a real bug this popup already fixed — it once rendered {"error":"invalid_token"} as the
    // "consent summary" and still offered Approve, which WORKED (signing is device-side). Blind
    // signing is what a consent screen exists to prevent. Moving the decode in-bundle must not
    // reopen that: a throw must still be terminal, with Reject only.
    expect(SIGN_TSX).toMatch(/setActions\(true\)/);
  });
});
