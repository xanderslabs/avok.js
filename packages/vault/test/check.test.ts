import { describe, it, expect } from "vitest";
import { evaluateDeployedHeaders } from "../src/check.js";

const good = new Headers({
  "content-security-policy":
    "default-src 'none'; script-src 'sha256-x'; connect-src 'none'; frame-ancestors 'none'; " +
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
      "default-src 'none'; script-src 'sha256-x'; connect-src 'none'; frame-ancestors 'none'",
    );
    expect(evaluateDeployedHeaders(h).problems.join(" ")).toContain("trusted-types");
  });

  it("collects every problem rather than stopping at the first", () => {
    const result = evaluateDeployedHeaders(new Headers({}));
    expect(result.problems.length).toBeGreaterThan(4);
  });
});
