import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// #8's "the popup is self-contained" guards. They used to read app/src/sign.tsx; the popup is now the
// framework-free driver + wiring in src/auth-popup/ (mountAuthPopup), so they re-anchor there. The
// BEHAVIOUR (reject-only on a failed decode, reply shapes, ready handshake) is pinned end-to-end in
// src/auth-popup/ceremony.test.ts; these remain the cheap static "#8 can't quietly regress" guards.
const read = (f: string) => readFileSync(resolve(process.cwd(), "src/auth-popup", f), "utf8");
const CEREMONY = read("ceremony.ts");
const MOUNT = read("mount.ts");
const VIEW = read("view-dom.ts");

// Strip comments so a guard fires on CODE, not on prose that legitimately names a removed symbol.
const codeOf = (src: string): string =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("*/");
    })
    .join("\n");

describe("the sign popup is self-contained (#8)", () => {
  it("makes NO network call at all", () => {
    // The popup's only fetch was POST /sign/consent — a token-gated decode of a stateless pure
    // function. With no token it has no job, and with no fetch the page is static-hostable — which is
    // also what lets connect-src drop to 'none'.
    for (const src of [CEREMONY, MOUNT, VIEW]) {
      expect(src).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("decodes and formats in-bundle", () => {
    // The endpoint returned formatConsentDisplay(decodeSignConsent(request)) — BOTH halves live in the
    // driver now.
    expect(CEREMONY).toMatch(/decodeSignConsent/);
    expect(CEREMONY).toMatch(/formatConsentDisplay/);
  });

  it("takes credentialId from the REQUEST, not from a token", () => {
    // /sign/consent returned { display, credentialId } off the access token's claims. Without it the
    // browser cannot constrain the assertion and the user picks a passkey on EVERY signature. It
    // rehomes onto the sign request (the message carries credentialId?). Match CODE, not prose.
    const code = codeOf(CEREMONY) + "\n" + codeOf(MOUNT);
    expect(code).not.toMatch(/sessionId/);
    expect(code).toMatch(/credentialId/);
  });

  it("still signs in-page via performSign", () => {
    // Guard the money path: performSign was ALWAYS browser-side; #8 and the refactor must not disturb it.
    expect(MOUNT).toMatch(/performSign/);
  });

  it("still refuses to approve a request it could not decode", () => {
    // A real bug this popup already fixed: it once rendered {"error":"invalid_token"} as the consent
    // summary and still offered Approve, which WORKED (signing is device-side). A failed decode must
    // stay terminal — reject-only. The driver catches the decode and flips rejectOnly.
    const signBlock = CEREMONY.slice(CEREMONY.indexOf("async function runSign"));
    expect(signBlock).toMatch(/catch/);
    expect(signBlock).toMatch(/rejectOnly = true/);
  });
});
