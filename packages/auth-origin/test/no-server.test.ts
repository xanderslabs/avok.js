import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const p = (f: string) => resolve(process.cwd(), f);

/**
 * Read CODE, not prose. A removed symbol legitimately appears in a comment explaining that it was
 * removed and why — that is documentation, not a reintroduction. Matching the raw file would make
 * this guard fire on its own explanation.
 */
function codeOf(file: string): string {
  return readFileSync(p(file), "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("*/");
    })
    .join("\n");
}
const config = () => codeOf("src/config.ts");

describe("the auth origin is not a server (#8)", () => {
  it("has no HTTP server, no OIDC, no mint, and NO STORE", () => {
    // WHY: Challenge/Code/Session stores were already deleted (store/ports.ts records each);
    // ClientStore was the last one, and it dies with `curated`. The origin now holds NOTHING.
    for (const f of ["src/http.ts", "src/oidc", "src/mint", "src/store", "src/app/render.ts"]) {
      expect(existsSync(p(f))).toBe(false);
    }
  });

  it("config carries no server half", () => {
    for (const k of ["issuer", "signingKey", "verificationKeys", "clientRegistration", "relatedOrigins", "allowedOrigins"]) {
      expect(config()).not.toMatch(new RegExp(`\\b${k}\\b`));
    }
  });

  it("has no client allowlist — open/MetaMask-style is a CLOSED decision (VISION §7)", () => {
    // WHY: `curated` gatekeeps which dapps a user can reach — config.ts itself said it "must never
    // become an implicit default… which the model does not do". The popup exists precisely to serve
    // an UNBOUNDED third-party set (§6). Anybody can implement the connection; the consent screen is
    // the gate.
    expect(config()).not.toMatch(/curated|allowlist|allowedOrigins/i);
  });

  it("does not serve ROR — that is own-origin's, and the standard owns the tooling", () => {
    // WHY: VISION §6 puts ROR on own-origin ("no popup, no server") at the rpId ROOT. The standard
    // already carries the logic (reference/src/related-origins.ts, vectors/related-origins.json).
    // Serving it here was an artifact of an auth origin sometimes sitting at the rpId root.
    expect(config()).not.toMatch(/webauthn|relatedOrigins/);
  });

  it("KEEPS the pinned-rpId fail-loud", () => {
    // WHY: K = HKDF(PRF(credential, rpId)). An unset — or worse, URL-inferred — rpId is a
    // wallet-drain defect, not a convenience gap. It must not die with the server.
    expect(config()).toMatch(/assertRpId/);
  });

  it("KEEPS the popup's config resolution, incl. the anchor chain it actually reads", () => {
    // WHY: checked before deleting rather than assumed — app/branding.ts reads anchorChainId to
    // derive defaultChainId for the popup. Removing it as "server config" would have broken the page.
    const branding = readFileSync(p("src/app/branding.ts"), "utf8");
    expect(branding).toMatch(/resolveAppConfig/);
    expect(branding).toMatch(/anchorChainId/);
  });
});
