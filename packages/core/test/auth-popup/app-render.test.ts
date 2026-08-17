import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppConfig } from "../../src/auth-popup/app/branding.js";
import type { OriginConfig } from "../../src/auth-popup/config.js";

// The operator's baked config. Deliberately mounted on a SUBDOMAIN with a narrower rpId — that gap
// is what the pinned-rpId guard below exists for.
const CONFIG: OriginConfig = {
  rpId: "qudi.fi",
  authOrigin: "https://auth.qudi.fi",
  branding: { operatorName: "Qudi" },
};

describe("the popup's config", () => {
  it("resolveAppConfig maps the origin config to the client AppConfig", () => {
    const app = resolveAppConfig(CONFIG);
    expect(app.operatorName).toBe("Qudi");
    expect(app.authOrigin).toBe("https://auth.qudi.fi");
  });

  // The popup MUST be told the operator's pinned rpId, never `new URL(authOrigin).hostname`. For an
  // origin mounted on a SUBDOMAIN (auth.qudi.fi) that derivation yields the WRONG rpId
  // (auth.qudi.fi ≠ qudi.fi) — so discover() finds no passkey, and worse,
  // K = HKDF(PRF(credential, rpId)) derives a DIFFERENT WALLET.
  it("injects the operator's PINNED rpId — never the authOrigin hostname", () => {
    const app = resolveAppConfig(CONFIG);
    expect(app.rpId).toBe("qudi.fi");
    expect(app.rpId).not.toBe(new URL(CONFIG.authOrigin).hostname); // "auth.qudi.fi"
  });
});

// The popup's runtime is now the framework-free driver + plain-DOM view + mount wiring in
// src/auth-popup/ (mountAuthPopup). The BEHAVIOURAL contracts the
// old regex source-guards approximated — the ChannelResult reply shape, the `ready` handshake, the
// reject-only-on-failed-decode blind-signing guard, the credentialId-constrain-then-fallback — are now
// pinned end-to-end in src/auth-popup/ceremony.test.ts (a fake window + fake view), which is strictly
// stronger than matching source text across a postMessage boundary. What remains here is the STATIC
// safety net a behavioural test cannot give: that the popup's sources carry no script-injection sink,
// and the shipped bundle carries no eval — the guarantees that license enforcing Trusted Types.

const POPUP_SRC = resolve(process.cwd(), "src/auth-popup");

/**
 * TRUSTED TYPES, ENFORCED.
 *
 * An XSS on this origin is a WALLET DRAIN — the rpId origin can run the WebAuthn ceremony, and
 * K = HKDF(PRF(credential, rpId)). `require-trusted-types-for 'script'` (asserted in @avokjs/vault) makes every DOM
 * script-injection sink throw unless the value went through a Trusted Types policy; it is the directive
 * that turns "we found no sinks" into "a sink cannot run". This guard is what licenses enforcing it.
 */
describe("the popup enforces Trusted Types", () => {
  it("the popup sources contain NO script-injection sink", () => {
    // view-dom.ts builds nodes with createElement + textContent only; nothing here may reach for an
    // HTML-string sink. The page bootstrap scanned alongside these now lives in @avokjs/vault and is
    // scanned by that package's suite.
    const files = [join(POPUP_SRC, "ceremony.ts"), join(POPUP_SRC, "view-dom.ts"), join(POPUP_SRC, "mount.ts")];
    for (const path of files) {
      const src = readFileSync(path, "utf8");
      expect(src, `${path} must not use a script-injection sink`).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|dangerouslySetInnerHTML/,
      );
    }
  });
});
