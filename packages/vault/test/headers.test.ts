import { describe, it, expect } from "vitest";
import {
  buildCsp,
  securityHeaders,
  recoverySecurityHeaders,
  headersFileContent,
  RECOVERY_PATH_GLOB,
} from "../src/headers.js";

const RPC_URLS = ["https://mainnet.base.org", "https://ethereum-rpc.publicnode.com"];

describe("buildCsp", () => {
  const csp = buildCsp(["abc123", "def456"], RPC_URLS);

  it("locks default/img to none, which is only honest because the page fetches nothing else", () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("img-src 'none'");
  });

  it("pins connect-src to exactly the configured RPC origins — not 'none', not wildcard", () => {
    expect(csp).toContain("connect-src https://mainnet.base.org https://ethereum-rpc.publicnode.com");
    expect(csp).not.toContain("connect-src 'none'");
    expect(csp).not.toMatch(/connect-src[^;]*\*/);
  });

  it("dedupes connect-src by ORIGIN — an RPC URL's path is irrelevant to CSP matching", () => {
    const withPath = buildCsp(["abc123"], ["https://mainnet.base.org/", "https://mainnet.base.org/v2/key"]);
    expect(withPath).toContain("connect-src https://mainnet.base.org");
    expect(withPath.match(/mainnet\.base\.org/g)).toHaveLength(1);
  });

  it("admits scripts and styles by hash and never by nonce or unsafe-inline", () => {
    expect(csp).toContain("script-src 'sha256-abc123' 'sha256-def456'");
    expect(csp).toContain("style-src 'sha256-abc123' 'sha256-def456'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("nonce-");
  });

  it("refuses to be framed, which popup-only makes free", () => {
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("requires trusted types, since the view builds DOM programmatically", () => {
    expect(csp).toContain("require-trusted-types-for 'script'");
  });

  // A CSP with an empty script-src admits NOTHING, so the page is blank and the failure looks like a
  // broken build rather than a broken policy. Refuse to emit one.
  it("refuses to build a policy with no hashes", () => {
    expect(() => buildCsp([], RPC_URLS)).toThrow(/hash/i);
  });

  // Same reasoning, the other direction: no chains configured must fail loud, not silently ship a
  // Vault that can never simulate or read guardian state.
  it("refuses to build a policy with no connect-src origins", () => {
    expect(() => buildCsp(["abc123"], [])).toThrow(/connect-src/i);
  });
});

describe("securityHeaders", () => {
  const h = securityHeaders();

  it("states origin isolation explicitly rather than inheriting a browser default", () => {
    expect(h["Origin-Agent-Cluster"]).toBe("?1");
  });

  it("sends HSTS with includeSubDomains, since the Vault origin is the wallet's identity", () => {
    expect(h["Strict-Transport-Security"]).toContain("includeSubDomains");
    expect(h["Strict-Transport-Security"]).toContain("preload");
  });

  it("denies framing for agents that ignore frame-ancestors", () => {
    expect(h["X-Frame-Options"]).toBe("DENY");
  });

  it("leaks no referrer and refuses MIME sniffing", () => {
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });

  // REGRESSION GUARD. COOP same-origin severs window.opener, and the popup's ONLY way to return a
  // result is through that relationship. It would fail after the user has read the screen and
  // completed biometrics, which is the worst possible place to fail. Its absence is deliberate, and
  // this test exists so a later security sweep cannot add it quietly.
  it("never sets Cross-Origin-Opener-Policy, which would break the reply path", () => {
    expect(h).not.toHaveProperty("Cross-Origin-Opener-Policy");
  });
});

describe("recoverySecurityHeaders", () => {
  const h = recoverySecurityHeaders();

  // Identity recovery's threaded-WASM proving (D7) needs a cross-origin-isolated context. The page
  // has zero external resources (assertVaultInvariants forbids any), so COEP costs it nothing to
  // embed and blocks nothing it was ever going to load.
  it("sets Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp", () => {
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(h["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
  });

  it("still carries every header the signing route gets", () => {
    const base = securityHeaders();
    for (const [name, value] of Object.entries(base)) expect(h[name]).toBe(value);
  });
});

describe("headersFileContent", () => {
  const out = headersFileContent(buildCsp(["abc123"], RPC_URLS));

  it("emits a static-host block for the signing route carrying the CSP and every other header", () => {
    expect(out).toContain("Content-Security-Policy:");
    expect(out).toContain("Origin-Agent-Cluster: ?1");
  });

  /**
   * THE PATH IS THE WHOLE POINT, AND IT WAS WRONG.
   *
   * The build this replaces emitted a rule for `/index`. The file it emits is `index.html`, served
   * at `/` and at `/index.html`. On Netlify and Cloudflare Pages a `_headers` path matches the
   * REQUEST path, so `/index` matched neither, and every header in the file was silently inert: a
   * fully hardened page served with no CSP at all.
   *
   * A wrong path fails in exactly the way a security control must never fail. It is invisible,
   * because the page works perfectly, and only a response-header check would ever notice. `/*`
   * matches every path the Vault can be reached at except the recovery route, which gets its own
   * block below with its own header set.
   */
  it("applies the base block to every path, not just one spelling of it", () => {
    expect(out.split("\n")[0]).toBe("/*");
    expect(out).not.toMatch(/^\/index$/m);
  });

  it("indents each header under its own path block", () => {
    for (const line of out.split("\n").filter(Boolean)) {
      const isPathLine = line === "/*" || line === RECOVERY_PATH_GLOB;
      if (!isPathLine) expect(line.startsWith("  ")).toBe(true);
    }
  });

  /**
   * ONE PAGE, TWO ROUTES, TWO HEADER SETS (D7 gate decision, 2026-08-18). Identity recovery will run
   * threaded-WASM proving on the recovery route, which needs COOP+COEP — but the signing popup route
   * has a hard NO-COOP invariant (COOP severs window.opener, the popup's only way home). The recovery
   * block is declared AFTER the base `/*` block: Netlify and Cloudflare Pages apply every matching
   * rule and let a later rule's header win over an earlier rule's for the same name, so a request to
   * `/recover/*` picks up the base set from `/*` PLUS the recovery block's COOP/COEP, while a request
   * to `/` (which does not match `/recover/*`) gets only the base set — COOP stays absent there.
   */
  it("adds a second block for the recovery route, declared after the base block", () => {
    const recoverIdx = out.indexOf(RECOVERY_PATH_GLOB);
    expect(recoverIdx).toBeGreaterThan(out.indexOf("/*"));
    const recoverBlock = out.slice(recoverIdx);
    expect(recoverBlock).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(recoverBlock).toContain("Cross-Origin-Embedder-Policy: require-corp");
    expect(recoverBlock).toContain("Content-Security-Policy:");
  });

  it("keeps the base block free of COOP/COEP — only the recovery block carries them", () => {
    const baseBlock = out.slice(0, out.indexOf(RECOVERY_PATH_GLOB));
    expect(baseBlock).not.toContain("Cross-Origin-Opener-Policy");
    expect(baseBlock).not.toContain("Cross-Origin-Embedder-Policy");
  });
});
