/**
 * The Vault's CSP.
 *
 * HASHES, NOT A NONCE. A server mints a fresh nonce per response. A static file cannot, and a frozen
 * nonce is 'unsafe-inline' with extra steps the moment an attacker reads it once. Once the config is
 * baked the script bytes are fixed, so their sha256 is stable and unforgeable: an attacker cannot
 * produce the hash of a script they did not write.
 *
 * EVERYTHING ELSE IS 'none', and that is only honest because the page fetches nothing. All JS and CSS
 * is inlined at build. There is no CDN, no font, no analytics, no image host. A directive set to
 * 'none' that something actually needs gets relaxed within a week; these hold because nothing wants
 * them.
 *
 * Every directive here is carried over unchanged from the build this replaces. Only the emission
 * around it is new.
 */
export function buildCsp(hashes: string[]): string {
  if (hashes.length === 0) {
    // An empty script-src admits nothing, so the page renders blank. That reads as a broken build
    // rather than a broken policy, and the temptation is then to relax the CSP to "fix" it.
    throw new Error(
      "buildCsp: refusing to emit a policy with no script hashes. An empty script-src blocks the " +
        "page's own code, so the Vault would render blank. The caller must hash the final bytes " +
        "first, after the config is baked.",
    );
  }
  const pinned = hashes.map((h) => `'sha256-${h}'`).join(" ");
  return [
    "default-src 'none'",
    `script-src ${pinned}`,
    `style-src ${pinned}`,
    "connect-src 'none'",
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

/**
 * The `_headers` format understood by Netlify and Cloudflare Pages. Other hosts read the same values
 * out of csp-headers.txt.
 *
 * THE PATH IS `/*`, AND THAT IS A FIX. The build this replaces emitted `/index`, while the file it
 * emitted was `index.html`, served at `/` and `/index.html`. These hosts match a `_headers` path
 * against the REQUEST path, so `/index` matched neither and every header in the file was inert. The
 * page worked perfectly and shipped with no CSP, which is the failure mode a security control must
 * never have: invisible unless someone reads the response headers.
 *
 * `/*` matches every path the Vault can be reached at. There is one page, so there is nothing else
 * the wildcard could over-apply to.
 */
export function headersFileContent(csp: string): string {
  const lines = ["/*", `  Content-Security-Policy: ${csp}`];
  for (const [name, value] of Object.entries(securityHeaders())) {
    lines.push(`  ${name}: ${value}`);
  }
  return `${lines.join("\n")}\n`;
}
