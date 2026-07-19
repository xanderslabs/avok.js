import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// These read the BUILT output. `pnpm build:app` must have run — the suite says so loudly rather
// than silently passing on a stale or absent build.
const OUT = resolve(process.cwd(), "auth-page/app-inlined");
const built = existsSync(resolve(OUT, "csp-headers.txt"));
const csp = () => readFileSync(resolve(OUT, "csp-headers.txt"), "utf8");

describe.skipIf(!built)("the static popup's CSP is no weaker than the server's (#8)", () => {
  it("pins scripts by HASH, not by a frozen nonce", () => {
    // WHY: the server minted a FRESH nonce per response precisely because "an XSS on this origin is
    // a WALLET DRAIN", and warned that a reused nonce is "as weak as 'unsafe-inline'". A static page
    // cannot mint per-response nonces — so it must NOT simply freeze one. Once config is BAKED the
    // script bytes are fixed, so a sha256 is stable, and an attacker cannot forge the hash of a
    // script they did not write.
    expect(csp()).toMatch(/script-src [^;]*'sha256-/);
    expect(csp()).not.toMatch(/'nonce-/);
  });

  it("still denies everything the server's policy denied", () => {
    // Copied from http.ts's popupCsp() before it was deleted — the reasoning there is this policy's
    // spec, and none of it changed by going static.
    const c = csp();
    expect(c).not.toMatch(/unsafe-inline|unsafe-eval|strict-dynamic/);
    for (const d of [
      "default-src 'none'",
      "img-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      "form-action 'none'",
    ]) {
      expect(c).toContain(d);
    }
  });

  it("KEEPS Trusted Types ENFORCED, not report-only", () => {
    // WHY: this is what turns "we found no sinks" into "a sink cannot run". Under report-only a
    // violation is a console warning that changes nothing — exactly how a sink would survive an
    // "it works" test. app-render.test.ts's zero-sinks guard is what licenses enforcing it; the two
    // must survive together.
    expect(csp()).toContain("require-trusted-types-for 'script'");
    expect(csp()).toContain("trusted-types 'allow-duplicates'");
    expect(csp()).not.toMatch(/report-only/i);
  });

  it("drops connect-src to 'none' — the popup makes no network call", () => {
    // WHY: connect-src 'self' existed for POST /sign/consent. That fetch is gone: the decode is
    // in-bundle, so the page talks to nothing.
    expect(csp()).toMatch(/connect-src 'none'/);
  });

  it("the emitted hash matches the bundle actually shipped", () => {
    // WHY: a stale hash is a page that silently does not run — the worst failure available here,
    // because it looks like a deploy problem rather than a build bug. Recompute from the real HTML.
    for (const entry of ["index"]) {
      const html = readFileSync(resolve(OUT, `${entry}.html`), "utf8");
      const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      expect(inline.length).toBeGreaterThan(0);
      for (const s of inline) {
        const h = createHash("sha256").update(s, "utf8").digest("base64");
        expect(csp()).toContain(`'sha256-${h}'`);
      }
    }
  });

  it("bakes the operator's PINNED rpId into the page", () => {
    // WHY: K = HKDF(PRF(credential, rpId)). The config used to be injected per request by a server
    // that fails loud on a missing rpId; that guarantee must survive the move to build time.
    for (const entry of ["index"]) {
      const html = readFileSync(resolve(OUT, `${entry}.html`), "utf8");
      expect(html).toMatch(/window\.__AVOK_CONFIG__=/);
      expect(html).toMatch(/"rpId":/);
    }
  });

  it("escapes `<` in the baked config so it cannot close the script early", () => {
    for (const entry of ["index"]) {
      const html = readFileSync(resolve(OUT, `${entry}.html`), "utf8");
      const cfg = html.match(/window\.__AVOK_CONFIG__=(\{.*?\})<\/script>/s)?.[1] ?? "";
      expect(cfg).not.toContain("<");
    }
  });
});

describe("the CSP guard is not silently skipped", () => {
  it("tells you to build rather than passing on an absent build", () => {
    // WHY: describe.skipIf reads as green. If app-inlined/ is missing, say so — a skipped guard that
    // looks passing is the failure mode #6's 78 rotted errors were made of.
    if (!built) {
      throw new Error(
        "app-inlined/csp-headers.txt is missing — run `pnpm emit:auth-page` before this suite. " +
          "The CSP guards cannot run against a build that does not exist.",
      );
    }
    expect(built).toBe(true);
  });
});
