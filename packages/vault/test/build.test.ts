import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inlinePage, assertVaultInvariants } from "../src/build.js";
import { parseVaultConfig } from "../src/config.js";

const config = parseVaultConfig({ rpId: "vault.example1.com", vaultOrigin: "https://vault.example1.com" });

const html =
  `<!doctype html><html><head>` +
  `<link rel="stylesheet" href="/assets/app.css">` +
  `</head><body><div id="root"></div>` +
  `<script type="module" crossorigin src="/assets/app.js"></script></body></html>`;

const assets = new Map([
  ["assets/app.js", "console.log('vault')"],
  ["assets/app.css", "body{margin:0}"],
]);

describe("inlinePage", () => {
  it("leaves no external script or stylesheet reference", () => {
    const { html: out } = inlinePage({ html, assets, config });
    expect(out).not.toContain('src="/assets/app.js"');
    expect(out).not.toContain('href="/assets/app.css"');
    expect(out).toContain("console.log('vault')");
    expect(out).toContain("body{margin:0}");
  });

  it("bakes the config before the first module script", () => {
    const { html: out } = inlinePage({ html, assets, config });
    expect(out.indexOf("__AVOK_CONFIG__")).toBeLessThan(out.indexOf("console.log('vault')"));
    expect(out).toContain('"rpId":"vault.example1.com"');
  });

  it("escapes < in config values so a value can never close the script tag early", () => {
    const evil = parseVaultConfig({
      rpId: "vault.example1.com",
      vaultOrigin: "https://vault.example1.com",
      branding: { operatorName: "</script><script>alert(1)</script>" },
    });
    const { html: out } = inlinePage({ html, assets, config: evil });
    expect(out).not.toContain("</script><script>alert(1)");
    expect(out).toContain("\\u003c/script>");
  });

  it("hashes the FINAL bytes, so the CSP describes the page that actually ships", () => {
    const { html: out, csp } = inlinePage({ html, assets, config });
    const hashes = [...csp.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]);
    expect(hashes.length).toBeGreaterThan(0);
    for (const h of hashes) expect(csp).toContain(h);
    expect(out).toContain("__AVOK_CONFIG__");
  });

  it("produces a CSP that an appended script would violate", () => {
    const clean = inlinePage({ html, assets, config });
    const tampered = inlinePage({
      html: html.replace("</body>", "<script>steal()</script></body>"),
      assets,
      config,
    });
    expect(tampered.csp).not.toBe(clean.csp);
  });

  it("emits a headers file carrying the CSP and the rest", () => {
    const { headers } = inlinePage({ html, assets, config });
    expect(headers).toContain("Content-Security-Policy:");
    expect(headers).toContain("Origin-Agent-Cluster: ?1");
  });

  it("fails loud when an asset the page references is missing, rather than shipping a broken page", () => {
    expect(() => inlinePage({ html, assets: new Map(), config })).toThrow(/assets\/app\.(js|css)/);
  });
});

/**
 * THE INVARIANT OF THE WHOLE PACKAGE, and it used to live somewhere it could stop running.
 *
 * These checks were `auth-page/scripts/verify-inlined.mjs`, a build step, mirrored by a
 * `describe.skipIf(!built)` suite that read the emitted artifact. That suite SKIPS when the build has
 * not run, so moving the build out of `@avokjs/core` would have left it skipping silently forever:
 * green, permanently, while testing nothing. That is the same absence-reads-as-success shape the
 * repo's own `check:wiring` exists to prevent.
 *
 * They now run against `inlinePage`'s return value, which is pure. There is no artifact to be
 * missing and no condition under which they do not execute.
 *
 * What they defend: an XSS or a stray external script on the Vault origin is a WALLET DRAIN, because
 * that origin can run the WebAuthn ceremony and `K = HKDF(PRF(credential, rpId))`.
 */
describe("the Vault invariants, which cannot skip", () => {
  const built = inlinePage({ html, assets, config });

  it("ships no external script, stylesheet, or absolute URL", () => {
    expect(() => assertVaultInvariants(built)).not.toThrow();
  });

  it("rejects a page that kept an external script", () => {
    expect(() => assertVaultInvariants({ ...built, html: `${built.html}<script src="/x.js"></script>` })).toThrow(
      /external <script/,
    );
  });

  it("rejects a page that kept an external stylesheet", () => {
    expect(() =>
      assertVaultInvariants({ ...built, html: `${built.html}<link rel="stylesheet" href="/x.css">` }),
    ).toThrow(/external stylesheet/);
  });

  it("rejects a page that references an http(s) URL, which default-src none would block anyway", () => {
    expect(() =>
      assertVaultInvariants({ ...built, html: `${built.html}<img src="https://cdn.example/x.png">` }),
    ).toThrow(/external http/);
  });

  it("rejects a CSP that is not hash-pinned", () => {
    expect(() => assertVaultInvariants({ ...built, csp: "default-src 'none'; script-src 'self'" })).toThrow(/sha256/);
  });

  it("rejects a CSP containing unsafe-inline", () => {
    expect(() => assertVaultInvariants({ ...built, csp: `${built.csp}; style-src 'unsafe-inline'` })).toThrow(
      /unsafe-inline/,
    );
  });

  it("rejects a CSP that lets the page talk to the network", () => {
    expect(() =>
      assertVaultInvariants({ ...built, csp: built.csp.replace("connect-src 'none'", "connect-src *") }),
    ).toThrow(/connect-src/);
  });

  it("bakes the operator's pinned rpId, since an inferred one derives a different wallet", () => {
    expect(built.html).toContain('"rpId":"vault.example1.com"');
  });
});

/**
 * TRUSTED TYPES, ENFORCED, and the two guards that license enforcing it.
 *
 * `require-trusted-types-for 'script'` makes every DOM script-injection sink throw unless the value
 * went through a policy. That directive is what turns "we found no sinks" into "a sink cannot run",
 * and it is only safe to enforce if the page genuinely has none: enforcement turns a reachable sink
 * into a broken wallet rather than a caught one.
 *
 * Both checks moved here from `@avokjs/core`, where they read `auth-page/`. The bundle half read an
 * emitted artifact behind `if (!existsSync(path)) return`, so it did nothing whenever the build had
 * not run. It now reads `inlinePage`'s output, which always exists.
 */
describe("the page enforces Trusted Types", () => {
  const PAGE_SRC = new URL("../page/src/", import.meta.url).pathname;

  it("the page sources contain NO script-injection sink", () => {
    const files = readdirSync(PAGE_SRC).filter((f) => /\.tsx?$/.test(f));
    expect(files.length, "the page must have sources to scan, or this guard is vacuous").toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(PAGE_SRC, f), "utf8");
      expect(src, `${f} must not use a script-injection sink`).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|dangerouslySetInnerHTML/,
      );
    }
  });

  // A sink is likeliest to arrive from a dependency rather than from our own code, which is why this
  // reads the FINAL page rather than the sources.
  it("the emitted page contains no eval or new Function", () => {
    const { html: out } = inlinePage({ html, assets, config });
    expect(out).not.toMatch(/[^.\w]eval\(/);
    expect(out).not.toMatch(/new Function/);
  });
});

/**
 * REGRESSION. The first real run of `buildVault` omitted `codeSplitting: false`, so vite emitted
 * shared chunks and left `<link rel="modulepreload" href="/assets/....js">` behind. The page shipped
 * at half its size, missing its own code, and every invariant above passed: a modulepreload is not a
 * script tag, not a stylesheet, and its href is root-relative rather than absolute.
 *
 * `default-src 'none'` then blocks the fetch that would have repaired it, so the failure is a blank
 * Vault at runtime rather than a red build.
 */
describe("un-inlined assets", () => {
  const built = inlinePage({ html, assets, config });

  it("rejects a page left with a modulepreload pointing at a chunk", () => {
    expect(() =>
      assertVaultInvariants({
        ...built,
        html: `${built.html}<link rel="modulepreload" href="/assets/chunk-abc.js">`,
      }),
    ).toThrow(/un-inlined asset/);
  });

  it("names every dangling reference, so the fix is obvious from the message", () => {
    try {
      assertVaultInvariants({ ...built, html: `${built.html}<link rel="modulepreload" href="/assets/x.js">` });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("/assets/x.js");
    }
  });
});
