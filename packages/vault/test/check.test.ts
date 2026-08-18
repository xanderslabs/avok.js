import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluateDeployedHeaders, runCheck, deriveRecoveryUrl } from "../src/check.js";
import { recoverySecurityHeaders } from "../src/headers.js";

const good = new Headers({
  "content-security-policy":
    "default-src 'none'; script-src 'sha256-x'; connect-src https://mainnet.base.org; frame-ancestors 'none'; " +
    "require-trusted-types-for 'script'",
  "origin-agent-cluster": "?1",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});

describe("evaluateDeployedHeaders", () => {
  it("passes a correctly configured deploy", () => {
    expect(evaluateDeployedHeaders(good)).toEqual({ ok: true, problems: [] });
  });

  // THE FAILURE THIS COMMAND EXISTS FOR. A host that ignores _headers serves a page that works
  // perfectly with all of its hardening absent, and nobody finds out.
  it("fails loudly when the CSP header is missing entirely", () => {
    const h = new Headers(good);
    h.delete("content-security-policy");
    const result = evaluateDeployedHeaders(h);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("Content-Security-Policy");
  });

  it("fails when the CSP admits unsafe-inline", () => {
    const h = new Headers(good);
    h.set("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'");
    expect(evaluateDeployedHeaders(h).ok).toBe(false);
  });

  it("fails when frame-ancestors is absent, since the page must never be framed", () => {
    const h = new Headers(good);
    h.set("content-security-policy", "default-src 'none'; script-src 'sha256-x'");
    expect(evaluateDeployedHeaders(h).problems.join(" ")).toContain("frame-ancestors");
  });

  it("flags a Cross-Origin-Opener-Policy that would sever the opener", () => {
    const h = new Headers(good);
    h.set("cross-origin-opener-policy", "same-origin");
    const result = evaluateDeployedHeaders(h);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("Cross-Origin-Opener-Policy");
  });

  it("reports each missing non-CSP header by name", () => {
    const h = new Headers(good);
    h.delete("origin-agent-cluster");
    expect(evaluateDeployedHeaders(h).problems.join(" ")).toContain("Origin-Agent-Cluster");
  });

  // A host can serve an OLDER policy than the one just built, which is the same silent failure as a
  // missing one. These two are the directives the build guarantees and a stale deploy would lack.
  it("fails when the deployed CSP lets the page reach the network", () => {
    const h = new Headers(good);
    h.set("content-security-policy", "default-src 'none'; script-src 'sha256-x'; frame-ancestors 'none'");
    expect(evaluateDeployedHeaders(h).problems.join(" ")).toContain("connect-src");
  });

  it("fails when Trusted Types is not enforced", () => {
    const h = new Headers(good);
    h.set(
      "content-security-policy",
      "default-src 'none'; script-src 'sha256-x'; connect-src https://mainnet.base.org; frame-ancestors 'none'",
    );
    expect(evaluateDeployedHeaders(h).problems.join(" ")).toContain("trusted-types");
  });

  it("fails when connect-src is 'none' — the deployed policy is stale (built before RPC pinning)", () => {
    const h = new Headers(good);
    h.set(
      "content-security-policy",
      "default-src 'none'; script-src 'sha256-x'; connect-src 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'",
    );
    const result = evaluateDeployedHeaders(h);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/connect-src.*stale/i);
  });

  it("fails when connect-src is wider than a pinned set (wildcard)", () => {
    const h = new Headers(good);
    h.set(
      "content-security-policy",
      "default-src 'none'; script-src 'sha256-x'; connect-src *; frame-ancestors 'none'; require-trusted-types-for 'script'",
    );
    expect(evaluateDeployedHeaders(h).problems.join(" ")).toContain("wider than a pinned RPC set");
  });

  it("collects every problem rather than stopping at the first", () => {
    const result = evaluateDeployedHeaders(new Headers({}));
    expect(result.problems.length).toBeGreaterThan(4);
  });

  // Explicit call with route: "signing" behaves exactly like the default (route-less) calls above —
  // the signing route is the default because it is the popup's own route, and nearly every deployed
  // Vault URL a caller checks is that one.
  it('route: "signing" is equivalent to the default', () => {
    expect(evaluateDeployedHeaders(good, { route: "signing" })).toEqual({ ok: true, problems: [] });
    const h = new Headers(good);
    h.set("cross-origin-opener-policy", "same-origin");
    expect(evaluateDeployedHeaders(h, { route: "signing" }).ok).toBe(false);
  });

  describe('route: "recovery"', () => {
    const goodRecovery = new Headers(good);
    for (const [k, v] of Object.entries(recoverySecurityHeaders())) goodRecovery.set(k.toLowerCase(), v);

    it("passes a correctly configured recovery-route deploy", () => {
      expect(evaluateDeployedHeaders(goodRecovery, { route: "recovery" })).toEqual({ ok: true, problems: [] });
    });

    // THE OTHER HALF OF THE D7 GATE DECISION. The recovery route needs a cross-origin-isolated
    // context for identity recovery's threaded-WASM proving — missing COOP/COEP there is the same
    // silent-failure shape as missing CSP: the page still works, proving just quietly can't run.
    it("fails when Cross-Origin-Opener-Policy is missing on the recovery route", () => {
      const h = new Headers(goodRecovery);
      h.delete("cross-origin-opener-policy");
      const result = evaluateDeployedHeaders(h, { route: "recovery" });
      expect(result.ok).toBe(false);
      expect(result.problems.join(" ")).toContain("Cross-Origin-Opener-Policy");
    });

    it("fails when Cross-Origin-Embedder-Policy is missing on the recovery route", () => {
      const h = new Headers(goodRecovery);
      h.delete("cross-origin-embedder-policy");
      const result = evaluateDeployedHeaders(h, { route: "recovery" });
      expect(result.ok).toBe(false);
      expect(result.problems.join(" ")).toContain("Cross-Origin-Embedder-Policy");
    });

    it("fails when the recovery route's COOP value is not same-origin", () => {
      const h = new Headers(goodRecovery);
      h.set("cross-origin-opener-policy", "unsafe-none");
      expect(evaluateDeployedHeaders(h, { route: "recovery" }).ok).toBe(false);
    });
  });
});

describe("deriveRecoveryUrl", () => {
  it("resolves /recover against the deployed URL's origin", () => {
    expect(deriveRecoveryUrl("https://vault.example1.com")).toBe("https://vault.example1.com/recover");
  });

  it("ignores any path already on the given URL — the recovery route is origin-relative", () => {
    expect(deriveRecoveryUrl("https://vault.example1.com/some/path")).toBe("https://vault.example1.com/recover");
  });
});

describe("runCheck", () => {
  const good = new Headers({
    "content-security-policy":
      "default-src 'none'; script-src 'sha256-x'; connect-src https://mainnet.base.org; frame-ancestors 'none'; " +
      "require-trusted-types-for 'script'",
    "origin-agent-cluster": "?1",
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  const goodRecovery = new Headers(good);
  for (const [k, v] of Object.entries(recoverySecurityHeaders())) goodRecovery.set(k.toLowerCase(), v);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checks BOTH the signing route and the derived recovery route", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const headers = url.endsWith("/recover") ? goodRecovery : good;
      return new Response(null, { status: 200, headers });
    });
    vi.stubGlobal("fetch", fetchMock);
    const lines: string[] = [];
    const code = await runCheck("https://vault.example1.com", (s) => lines.push(s));
    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith("https://vault.example1.com", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith("https://vault.example1.com/recover", expect.anything());
  });

  // THE FAILURE THIS TASK EXISTS FOR: a deploy that only wires the signing route's headers (or vice
  // versa) must not report success just because ONE of the two routes is correct.
  it("fails when the recovery route is missing its COOP/COEP even though the signing route is fine", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) => new Response(null, { status: 200, headers: url.endsWith("/recover") ? good : good }),
      ),
    );
    const lines: string[] = [];
    const code = await runCheck("https://vault.example1.com", (s) => lines.push(s));
    expect(code).toBe(1);
    expect(lines.join(" ")).toContain("recover");
  });

  it("fails when the signing route wrongly carries COOP even though the recovery route is fine", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(null, { status: 200, headers: url.endsWith("/recover") ? goodRecovery : goodRecovery }),
      ),
    );
    const code = await runCheck("https://vault.example1.com", () => {});
    expect(code).toBe(1);
  });
});
