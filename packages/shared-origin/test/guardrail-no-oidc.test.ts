import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as sharedOrigin from "../src/index.js";

/**
 * The #8 anti-drift guard (mirrors #5/#6/#9). It greps the repo for the surfaces the collapse
 * removed, so a future change cannot quietly reintroduce a server, a token, or a gate on which dapp
 * may connect — and cannot quietly lose the protections that replaced them.
 *
 * execFileSync with an argument array, not execSync with a string: no shell, so nothing in a pattern
 * or a path is interpreted as a metacharacter.
 */
const ROOT = resolve(process.cwd(), "../..");

/** Suites whose JOB is to name a removed symbol in an absence assertion — never drift. */
const ABSENCE_GUARDS = [
  "guardrail-no-oidc.test.ts",
  "no-server.test.ts",
  "decode-in-bundle.test.ts",
  "csp.test.ts",
  // Asserts the README names no deleted API, so it must name them to forbid them.
  "readme-truth.test.ts",
];

function grepRepo(pattern: string): string[] {
  try {
    const out = execFileSync(
      "grep",
      [
        "-rIn",
        "--exclude-dir=node_modules",
        "--exclude-dir=dist",
        "--exclude-dir=app-dist",
        "--exclude-dir=app-inlined",
        "--exclude-dir=.git",
        "-E",
        pattern,
        `${ROOT}/packages`,
        `${ROOT}/examples`,
      ],
      { encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean).filter((l) => !ABSENCE_GUARDS.some((g) => l.includes(g)));
  } catch (e) {
    // grep exits 1 for "no matches" — a PASS here. Any other status is real.
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}

/**
 * Read CODE, not prose. A removed symbol legitimately appears in a comment explaining that it was
 * removed and why — that is documentation, not a reintroduction.
 */
function codeOnly(lines: string[]): string[] {
  return lines
    .filter((l) => !l.split(":", 1)[0]!.endsWith(".md"))
    .filter((l) => {
      const body = l.replace(/^[^:]*:\d+:/, "").trim();
      return !body.startsWith("//") && !body.startsWith("*") && !body.startsWith("/*");
    });
}

describe("#8 guardrail: the auth-origin collapse holds", () => {
  it("no package speaks OIDC", () => {
    expect(codeOnly(grepRepo("id_token|access_token|generatePkce|buildAuthorizeUrl|exchangeCode|clientRegistration"))).toEqual([]);
  });

  it("nothing holds a session or a token", () => {
    // `revalidate` is matched bare, not as `revalidate\(`: it must not come back as a property or a
    // type either. `accessToken` is the camelCase spelling — the snake_case `access_token` above is a
    // different string and would not catch it.
    expect(codeOnly(grepRepo("sessionToken|revalidate|accessToken|OidcSession|SessionExpiredError"))).toEqual([]);
  });

  it("the OIDC modules are gone from shared-origin/src", () => {
    for (const f of ["oidc-client.ts", "jwt-verify.ts"]) {
      expect(existsSync(resolve(ROOT, "packages/shared-origin/src", f))).toBe(false);
    }
  });

  it("shared-origin exports no OIDC surface AT RUNTIME, not merely in its source text", () => {
    // WHY a runtime check when grepRepo already scans the source: a symbol re-exported through
    // `export * from "<dep>"` never appears as text here, so the grep cannot see it. This reads the
    // built module object instead, which is what a consumer actually gets.
    for (const sym of ["generatePkce", "buildAuthorizeUrl", "exchangeCode"]) {
      expect(sharedOrigin).not.toHaveProperty(sym);
    }
  });

  it("the channel carries credentialId, not sessionId, and returns no OIDC code", () => {
    // WHY: the two type changes are the whole cutover. sessionId only ever fed the token-gated
    // decode (now in-bundle) — but credentialId took its place, because the token was ALSO what
    // carried it, and without it the browser asks the user to pick a passkey on every signature.
    // The authorize round-trip returns the ACCOUNT, not a code to exchange.
    const port = readFileSync(resolve(ROOT, "packages/shared-origin/src/channels/port.ts"), "utf8")
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(port).not.toMatch(/sessionId/);
    expect(port).toMatch(/credentialId/);
    expect(port).not.toMatch(/\bcode\b/);
    expect(port).toMatch(/account/);
  });

  it("there is NO client allowlist — open/MetaMask-style is a CLOSED decision (VISION §7)", () => {
    // WHY: `curated` gatekept which dapps a user could reach, "which the model does not do". The
    // popup exists precisely to serve an UNBOUNDED third-party set (§6). Anybody can implement the
    // connection; the consent screen is the gate. Do not re-litigate this — re-read VISION first.
    expect(codeOnly(grepRepo("curated|allowedOrigins|isAllowed\\("))).toEqual([]);
  });

  it("the deleted server is gone", () => {
    for (const f of ["src/http.ts", "src/oidc", "src/mint", "src/store", "src/app/render.ts"]) {
      expect(existsSync(resolve(ROOT, "packages/auth-origin", f))).toBe(false);
    }
    expect(codeOnly(grepRepo("createOrigin\\(|\"/sign/consent\"|\"/authorize/complete\"|\"/authorize/challenge\""))).toEqual([]);
  });

  it("the popup makes no network call — that is what makes it static-hostable", () => {
    const hits = grepRepo("\\bfetch\\s*\\(").filter((l) => l.includes("/packages/auth-origin/app/src/"));
    expect(codeOnly(hits)).toEqual([]);
  });

  // ── and what must NOT be lost with them ────────────────────────────────────────────────────
  it("KEEPS the web channel's origin+source pinning", () => {
    // WHY: this is the protection that made `state` unnecessary on web. Lose it and the popup will
    // answer anyone.
    const web = grepRepo("event\\.origin !== expectedOrigin");
    expect(web.length).toBeGreaterThan(0);
    expect(grepRepo("event\\.source !== popup").length).toBeGreaterThan(0);
  });

  it("KEEPS assertRpId's fail-loud", () => {
    // WHY: K = HKDF(PRF(credential, rpId)). An unset or URL-inferred rpId is a wallet drain.
    expect(grepRepo("assertRpId").length).toBeGreaterThan(0);
  });

  it("KEEPS Trusted Types enforced in the emitted CSP", () => {
    expect(grepRepo("require-trusted-types-for 'script'").length).toBeGreaterThan(0);
  });
});
