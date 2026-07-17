import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as network from "../src/index.js";

/**
 * THE README MUST NOT DESCRIBE AN API THAT DOES NOT EXIST.
 *
 * This exists because it happened. Before this test, README.md opened by selling "OIDC + PKCE against
 * an operator origin" — an architecture #8 deleted — and went on to document `connection.revalidate()`,
 * a `SessionExpiredError` import that would not compile, a `redirectUri` option that is not an option,
 * `connection.authorize()` (it is `connect()`), and a "signed session token the user carries" when the
 * tokens were gone. Roughly three of its four sections were false, for months.
 *
 * ── Why the #8 guardrail could not catch it ─────────────────────────────────────────────────────────
 *
 * guardrail-no-oidc.test.ts greps the repo, but its `codeOnly()` filter deliberately strips `.md`:
 * "a removed symbol legitimately appears in a comment explaining that it was removed — that is
 * documentation, not a reintroduction." That is correct for comments, and it is exactly why a README
 * could go on claiming a deleted feature with nothing watching. This README even says "no OIDC" now,
 * which a naive prose grep would flag.
 *
 * So this does not grep prose. Prose is judgement. IDENTIFIERS are not: if the README tells a reader to
 * import a symbol, that symbol must exist. That check is unambiguous, self-maintaining, and it would
 * have failed on `SessionExpiredError` the day #8 deleted it.
 */

const README = readFileSync(resolve(process.cwd(), "README.md"), "utf8");

describe("README truth", () => {
  it("every symbol it tells you to import from this package actually exists", () => {
    // `import { a, b } from "@avokjs/network";` → ["a", "b"]
    const imports = [...README.matchAll(/import\s*\{([^}]+)\}\s*from\s*"@avokjs\/network"/g)]
      .flatMap((m) => m[1]!.split(","))
      .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
      .filter(Boolean);

    expect(imports.length, "README shows no imports — did the code fence change shape?").toBeGreaterThan(0);

    const missing = imports.filter((sym) => !(sym in network));
    expect(missing, `README imports symbols this package does not export: ${missing.join(", ")}`).toEqual([]);
  });

  it("names no API that #8 deleted", () => {
    // IDENTIFIERS ONLY — never concept words. `PKCE` and `OIDC` belong nowhere near this list: the
    // README legitimately says "no OIDC" and "why there is no PKCE", and a denial is the opposite of
    // a claim. (Learned the hard way: an earlier draft listed `PKCE` and failed on its own corrected
    // README.) A symbol either resolves or it does not; prose needs a reader.
    for (const dead of ["SessionExpiredError", "revalidate", "redirectUri", "sessionToken"]) {
      expect(README, `README names \`${dead}\`, which does not exist`).not.toMatch(new RegExp(`\\b${dead}\\b`));
    }
  });

  it("does not call connect() by its old name", () => {
    // `authorize` survives as a CHANNEL request kind (channels/port.ts) — it is the popup route, not a
    // connection verb. The README must not tell anyone to call `connection.authorize()`.
    expect(README).not.toMatch(/connection\.authorize\(/);
    expect(README).toMatch(/connection\.connect\(/);
  });
});
