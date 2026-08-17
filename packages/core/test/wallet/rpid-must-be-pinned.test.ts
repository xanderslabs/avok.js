import { describe, it, expect, afterEach } from "vitest";
import { WebAuthnPasskeyAdapter, MissingRpIdError } from "../../src/wallet/index.js";

/**
 * THE rpId IS THE KEY SCOPE, AND IT MUST BE PINNED.
 *
 * K = HKDF(PRF(credential, rpId)). The rpId is therefore not a setting — it decides WHICH WALLET a
 * passkey opens, and every origin that matches it can derive that key. `/.well-known/webauthn` is a
 * list of origins allowed to do exactly that: a key-access control list.
 *
 * So the adapter must NEVER fall back to `window.location.hostname` when no rpId is given. That
 * inference is wrong in two directions, and silent in both:
 *
 *   1. A hostname is not an rpId. An origin mounted on a subdomain (auth.example.com) legitimately
 *      asserts the APEX (example.com) — the origin is a tunnel to the wallet, not its own wallet.
 *      Inferring the hostname there scopes the key to the wrong domain.
 *
 *   2. It makes the wallet a function of the URL. The SAME app served from example.com and from
 *      app.example.com derives two DIFFERENT keys, i.e. two different wallets, and the user is simply
 *      told their passkey does not work.
 *
 * Every surface refuses to guess: the auth-popup build throws MissingRpIdError, and the native
 * adapter REQUIRES an rpId. The web adapter must hold the same line.
 */
describe("the rpId must be pinned — it can never be inferred", () => {
  const originalWindow = globalThis.window;
  afterEach(() => {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("REFUSES to construct without an rpId", () => {
    expect(() => new WebAuthnPasskeyAdapter({} as { rpId: string })).toThrow(MissingRpIdError);
  });

  it("REFUSES an empty or blank rpId — an empty key scope is not a key scope", () => {
    expect(() => new WebAuthnPasskeyAdapter({ rpId: "" })).toThrow(MissingRpIdError);
    expect(() => new WebAuthnPasskeyAdapter({ rpId: "   " })).toThrow(MissingRpIdError);
  });

  it("does NOT fall back to the page's hostname, even when one is available", () => {
    // The regression itself. With a window present the old adapter silently scoped the wallet key to
    // whatever host happened to be serving the page — so it constructed happily, and derived a key
    // nobody chose. It must still refuse.
    (globalThis as { window?: unknown }).window = { location: { hostname: "evil.example.com" } };
    expect(() => new WebAuthnPasskeyAdapter({} as { rpId: string })).toThrow(MissingRpIdError);
  });

  it("says WHY, so an operator does not just paste a hostname in to make it stop", () => {
    try {
      new WebAuthnPasskeyAdapter({ rpId: "" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/wallet key|never.*inferred/i);
    }
  });

  it("accepts an explicitly pinned rpId, including an apex asserted from a subdomain", () => {
    expect(() => new WebAuthnPasskeyAdapter({ rpId: "example.com" })).not.toThrow();
    expect(() => new WebAuthnPasskeyAdapter({ rpId: "wallet.example.com", rpName: "Example" })).not.toThrow();
  });
});
