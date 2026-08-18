/**
 * The Vault's CSP.
 *
 * HASHES, NOT A NONCE. A server mints a fresh nonce per response. A static file cannot, and a frozen
 * nonce is 'unsafe-inline' with extra steps the moment an attacker reads it once. Once the config is
 * baked the script bytes are fixed, so their sha256 is stable and unforgeable: an attacker cannot
 * produce the hash of a script they did not write.
 *
 * `connect-src` IS PINNED TO EXACTLY THE OPERATOR'S CONFIGURED RPC SET (TDD §8) — no longer `'none'`.
 * The Vault now reads chain state itself (vault/simulate's `eth_simulateV1`, vault/recover's guardian
 * reads), which needs somewhere to connect to. Pinning to the EXACT set the operator named at build
 * time, rather than opening the directive generally, keeps the same "nothing this page wants is
 * absent, nothing it doesn't want is present" property `'none'` had: the Vault can reach precisely
 * the RPCs it was built with and nothing else — not a third-party analytics endpoint, not an
 * attacker's exfiltration host.
 *
 * EVERYTHING ELSE IS 'none', and that is only honest because the page fetches nothing else. All JS
 * and CSS is inlined at build. There is no CDN, no font, no analytics, no image host. A directive set
 * to 'none' that something actually needs gets relaxed within a week; these hold because nothing
 * wants them.
 */
export function buildCsp(hashes: string[], connectSrcUrls: string[]): string {
  if (hashes.length === 0) {
    // An empty script-src admits nothing, so the page renders blank. That reads as a broken build
    // rather than a broken policy, and the temptation is then to relax the CSP to "fix" it.
    throw new Error(
      "buildCsp: refusing to emit a policy with no script hashes. An empty script-src blocks the " +
        "page's own code, so the Vault would render blank. The caller must hash the final bytes " +
        "first, after the config is baked.",
    );
  }
  if (connectSrcUrls.length === 0) {
    // Same reasoning as the script-src guard above: an empty connect-src is a broken build (no
    // chains configured), not a stricter policy, and must fail loudly rather than silently
    // degrading every request to "unsimulated".
    throw new Error(
      "buildCsp: refusing to emit a policy with no connect-src origins. Configure at least one chain " +
        "in avok-origin.config.json's `chains`.",
    );
  }
  const pinned = hashes.map((h) => `'sha256-${h}'`).join(" ");
  const connectSrc = [...new Set(connectSrcUrls.map((u) => new URL(u).origin))].join(" ");
  return [
    "default-src 'none'",
    `script-src ${pinned}`,
    `style-src ${pinned}`,
    `connect-src ${connectSrc}`,
    "img-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'allow-duplicates'",
  ].join("; ");
}

/**
 * The headers beyond CSP. The build this replaces emitted none of these: it wrote the CSP alone, so
 * a deployed Vault had no HSTS, no origin isolation, and no framing denial for agents that ignore
 * `frame-ancestors`.
 *
 * `Origin-Agent-Cluster: ?1` is origin isolation stated explicitly. The attack it addresses is
 * `document.domain`: a sibling subdomain and the Vault could both relax to a shared parent and become
 * same-origin, handing that sibling read access to the Vault. Chrome assigns origin-keyed agent
 * clusters by default from M106 and the `document.domain` setter has had no effect since Chrome 115,
 * so this states the requirement rather than inheriting a default that a stray `?0` could undo.
 *
 * DELIBERATELY ABSENT: Cross-Origin-Opener-Policy. See the regression test in headers.test.ts.
 */
export function securityHeaders(): Record<string, string> {
  return {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Origin-Agent-Cluster": "?1",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

/** The `_headers` path glob for the recovery route. Same page, same bytes, as `/*` — `mount.ts`
 *  decides client-side whether a direct navigation shows the signing popup's dead-end or the
 *  recovery screen (there is no opener either way). This glob exists ONLY so a static host's
 *  `_headers` rules can give that route a different response header set. */
export const RECOVERY_PATH_GLOB = "/recover/*";

/**
 * The recovery route's headers (D7 gate decision, 2026-08-18): everything `securityHeaders()` sets,
 * PLUS `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` —
 * a cross-origin-isolated context, which identity recovery's threaded-WASM JWT proving needs.
 *
 * Safe specifically BECAUSE the Vault is what it is: `assertVaultInvariants` already forbids any
 * external script, stylesheet, or URL, so the page has nothing cross-origin to embed and COEP blocks
 * nothing it was ever going to load. This is not true of pages in general — COEP breaks any
 * cross-origin resource that isn't CORP/CORS-cleared — it is true of THIS page because it has none.
 *
 * COOP is fine here for the reason it is forbidden on the signing route: this route is not a popup
 * with an opener to preserve. A direct navigation to the recovery screen has no `window.opener` to
 * sever in the first place.
 */
export function recoverySecurityHeaders(): Record<string, string> {
  return {
    ...securityHeaders(),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  };
}

/**
 * The `_headers` format understood by Netlify and Cloudflare Pages. Other hosts read the same values
 * out of csp-headers.txt and this module's header-building functions.
 *
 * THE PATH IS `/*`, AND THAT IS A FIX. The build this replaces emitted `/index`, while the file it
 * emitted was `index.html`, served at `/` and `/index.html`. These hosts match a `_headers` path
 * against the REQUEST path, so `/index` matched neither and every header in the file was inert. The
 * page worked perfectly and shipped with no CSP, which is the failure mode a security control must
 * never have: invisible unless someone reads the response headers.
 *
 * `/*` matches every path the Vault can be reached at, INCLUDING the recovery route — there is one
 * page. The recovery block below is declared SECOND and relies on both hosts' documented behavior of
 * applying every matching rule and letting a later rule's header win over an earlier rule's for the
 * same name: a request to `/recover/*` picks up the base set from `/*` plus the recovery block's
 * COOP/COEP; a request that does not match `/recover/*` gets only the base set, with COOP staying
 * hard-absent exactly as it always has.
 */
export function headersFileContent(csp: string): string {
  const block = (path: string, headers: Record<string, string>): string => {
    const lines = [path, `  Content-Security-Policy: ${csp}`];
    for (const [name, value] of Object.entries(headers)) lines.push(`  ${name}: ${value}`);
    return lines.join("\n");
  };
  return `${block("/*", securityHeaders())}\n${block(RECOVERY_PATH_GLOB, recoverySecurityHeaders())}\n`;
}
