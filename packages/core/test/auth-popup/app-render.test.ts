import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppConfig } from "../../src/auth-popup/app/branding.js";
import type { OriginConfig } from "../../src/auth-popup/config.js";

// The operator's baked config. Deliberately mounted on a SUBDOMAIN with a narrower rpId — that gap
// is what the pinned-rpId guard below exists for.
const CONFIG: OriginConfig = {
  rpId: "qudi.fi",
  authOrigin: "https://auth.qudi.fi",
  anchorChainId: "eip155:10",
  branding: { operatorName: "Qudi" },
};

describe("the popup's config", () => {
  it("resolveAppConfig maps the origin config to the client AppConfig", () => {
    const app = resolveAppConfig(CONFIG);
    expect(app.operatorName).toBe("Qudi");
    expect(app.authOrigin).toBe("https://auth.qudi.fi");
    expect(app.defaultChainId).toBe(10); // eip155:10 → 10
  });

  // The popups MUST be told the operator's pinned rpId. They used to derive it as
  // `new URL(authOrigin).hostname`, which for an origin mounted on a SUBDOMAIN (auth.qudi.fi)
  // yields the WRONG rpId (auth.qudi.fi ≠ qudi.fi) — so discover() finds no passkey, and worse,
  // K = HKDF(PRF(credential, rpId)) would derive a DIFFERENT WALLET. config.ts already calls an
  // inferred-from-URL rpId "a wallet-drain security defect"; the server guards it, so the popup
  // must not re-introduce it.
  it("injects the operator's PINNED rpId — never the authOrigin hostname", () => {
    const app = resolveAppConfig(CONFIG);
    expect(app.rpId).toBe("qudi.fi");
    expect(app.rpId).not.toBe(new URL(CONFIG.authOrigin).hostname); // "auth.qudi.fi"
  });

  it("the popup sources never derive an rpId from the URL", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const entry of ["authorize.tsx", "sign.tsx"]) {
      const src = readFileSync(join(__dirname, "../../auth-popup/app/src", entry), "utf8");
      expect(src).not.toMatch(/new URL\([^)]*authOrigin[^)]*\)\s*\.hostname/);
      expect(src).not.toMatch(/rpId:\s*new URL/);
    }
  });

  // The popups reply to the opener across a postMessage boundary, so TypeScript cannot check the
  // contract for us. It drifted once and nothing caught it: authorize posted
  // `{ type: "avok:authorize", url }` while the client's channel discriminates on `kind`. `kind` was
  // undefined, so the client silently DROPPED every reply and shared-origin login hung forever on
  // "Signing you in…". Pin the shape here — a source guard is the only thing that can span that
  // boundary. (#8: the payload is now `account`, not `code`+`state` — there is no OIDC code left to
  // exchange, and the address it carries is public.)
  it("the popups reply in the channel's ChannelResult shape (kind-discriminated)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const read = (f: string) => readFileSync(join(__dirname, "../../auth-popup/app/src", f), "utf8");

    const authorize = read("authorize.tsx");
    expect(authorize).toMatch(/postMessage\(\s*\{\s*kind:\s*"authorize"/);
    expect(authorize).toMatch(/account/);
    // The OIDC payload must not come back with the code flow that minted it.
    expect(authorize).not.toMatch(/postMessage\(\s*\{\s*kind:\s*"authorize",\s*code/);
    // The old broken shape must never come back.
    expect(authorize).not.toMatch(/postMessage\(\s*\{\s*type:/);
    expect(authorize).not.toMatch(/"avok:authorize"/);

    const sign = read("sign.tsx");
    expect(sign).toMatch(/postMessage\(\s*\{\s*kind:\s*"sign"/);
    expect(sign).not.toMatch(/postMessage\(\s*\{\s*type:/);
  });

  // The /sign popup's ONLY source of the request is a postMessage from the opener — and the opener
  // sends it in the same task as window.open(), before this document exists. postMessage does not
  // queue for an unloaded document, so that first send is always lost. Without the `ready` announce,
  // the popup waits forever on "Loading…" and shared-origin signing is dead (it was, in live testing).
  // Source-guarded because the handshake spans a postMessage boundary TypeScript cannot check.
  it("the sign popup announces `ready` so the opener can re-send the lost request", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sign = readFileSync(join(__dirname, "../../auth-popup/app/src/sign.tsx"), "utf8");
    expect(sign).toMatch(/opener\?\.postMessage\(\s*\{\s*kind:\s*"ready"\s*\}/);
    // It must be sent from the same effect that attaches the listener — announcing before listening
    // reintroduces the race in miniature.
    expect(sign.indexOf('addEventListener("message"')).toBeLessThan(sign.indexOf('kind: "ready"'));
  });

  // BLIND-SIGNING GUARD. The sign popup once enabled Approve unconditionally after POSTing
  // /sign/consent — no `r.ok` check — so a 401 rendered `{"error":"invalid_token"}` as the consent
  // summary and STILL offered Approve. Approve worked, because signing is device-side and never
  // consults the origin: the user would have signed a transaction the popup failed to decode and
  // never showed them. Approve must be reachable ONLY on a successful, displayed decode.
  //
  // #8 moved the decode IN-BUNDLE (there is no token to gate it and no endpoint left), so the
  // guard is re-anchored from the fetch chain to the decode block. The property is unchanged and
  // the teeth are the same: a failed decode DISABLES Approve, and Approve is enabled exactly once,
  // only after the summary is rendered. The failure mode is now a throw rather than a non-ok
  // response — the guard must still prove it is caught and terminal.
  it("the sign popup never enables Approve on a failed consent decode", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sign = readFileSync(join(__dirname, "../../auth-popup/app/src/sign.tsx"), "utf8");

    // Scope to the decode block. (Elsewhere, `setActions(true)` legitimately re-enables Approve
    // after a FAILED PASSKEY attempt — that is post-decode, the user has seen the request, and
    // retrying is correct. This guard is only about the decode.)
    const start = sign.indexOf("const display = formatConsentDisplay(decodeSignConsent(");
    const end = sign.indexOf('window.addEventListener("message"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const decodeBlock = sign.slice(start, end);

    // A decode that throws must be CAUGHT — an uncaught throw leaves the popup in whatever state
    // it was in, which is the blind-signing shape all over again.
    expect(decodeBlock).toMatch(/catch/);
    // An empty/absent summary must be treated as a failure, not rendered as consent.
    expect(decodeBlock).toMatch(/display\.length === 0/);
    // The failure path must actively DISABLE Approve, not merely skip enabling it.
    expect(decodeBlock).toMatch(/setActions\(false\)/);
    // Approve is enabled exactly once here, and only after the summary has been rendered.
    const enables = decodeBlock.match(/setActions\(true\)/g) ?? [];
    expect(enables).toHaveLength(1);
    expect(decodeBlock.indexOf("setConsent(display.join")).toBeLessThan(decodeBlock.indexOf("setActions(true)"));
  });



});

/**
 * THE SESSION MUST REMEMBER ITS PASSKEY.
 *
 * `discover()` with no credentialId shows the browser's account picker — right for a LOGIN, wrong for
 * every popup after it. Own-origin never had this problem: it remembers the credential it logged in with
 * and constrains every later assertion to it. Shared-origin learned the credentialId at authorize and
 * threw it away, so the user was asked to pick a passkey before every single signature.
 *
 * This crosses a postMessage + HTTP boundary that TypeScript cannot check, so it is guarded at the
 * source.
 */
describe("the sign popup constrains its assertion to the session's passkey", () => {
  it("authorize RECORDS the credential from the gesture it already performs (no second prompt)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const authorize = readFileSync(join(__dirname, "../../auth-popup/app/src/authorize.tsx"), "utf8");

    // The credentialId falls out of withDiscoveredKeys' meta — it must NOT trigger another discover().
    expect(authorize).toMatch(/meta\.credentialId/);
    expect(authorize).toMatch(/account\.credentialId = meta\.credentialId/);
    // ONE gesture. A direct passkey.discover() call here would mean a SECOND biometric prompt just to
    // learn which credential was used — the credentialId already falls out of the first one.
    expect(authorize).not.toMatch(/passkey\.discover\(/);
  });

  it("sign PASSES the credential into withDiscoveredKeys, and falls back if it is unusable", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sign = readFileSync(join(__dirname, "../../auth-popup/app/src/sign.tsx"), "utf8");

    expect(sign).toMatch(/credentialId: credential/);
    // A credential that has been removed or synced away must not dead-end the user in a wallet they
    // cannot open: fall back to the picker rather than a wall.
    expect(sign).toMatch(/catch \{[\s\S]*?return run\(\);/);
  });
});

/**
 * TRUSTED TYPES, ENFORCED.
 *
 * An XSS on this origin is a WALLET DRAIN — the rpId origin can run the WebAuthn ceremony, and
 * K = HKDF(PRF(credential, rpId)). `require-trusted-types-for 'script'` makes every DOM
 * script-injection sink throw unless the value went through a Trusted Types policy. It is the
 * directive that turns "we found no sinks" into "a sink cannot run".
 *
 * It shipped REPORT-ONLY while the popups had never been run end-to-end, because report-only cannot
 * break rendering. They have now been run — login, signing, sending — so it is enforced.
 */
describe("the popups enforce Trusted Types", () => {

  it("the popup sources contain NO script-injection sink", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname, "../../auth-popup/app/src");

    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
      const src = readFileSync(join(dir, file), "utf8");
      // Any of these would throw under enforcement — i.e. break the wallet — the moment they ran.
      expect(src, `${file} must not use a script-injection sink`).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|dangerouslySetInnerHTML/,
      );
    }
  });

  /**
   * The bundle is where a sink would actually come from — react-dom, not our code. This pins the
   * dependency: react-dom's only innerHTML ASSIGNMENTS are dangerouslySetInnerHTML (never used) and
   * its <script>-element creation path (the popups render div/pre/p/button only). If a future bump
   * introduces a reachable sink, enforcement turns it into a broken wallet — so fail here first.
   */
  it("the built popup bundle contains no eval / new Function", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");

    for (const page of ["sign.html", "authorize.html"]) {
      const path = join(__dirname, "..", "app-inlined", page);
      if (!existsSync(path)) continue; // not built in this environment
      const html = readFileSync(path, "utf8");
      expect(html, `${page} must not contain eval()`).not.toMatch(/[^.\w]eval\(/);
      expect(html, `${page} must not contain new Function`).not.toMatch(/new Function/);
    }
  });
});
