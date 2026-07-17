import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * The #6 anti-drift guard (mirrors #5's). It greps the repo for surfaces the spin-out removed, so a
 * future change cannot quietly reintroduce a core->add-on edge.
 *
 * execFileSync with an argument array, not execSync with a string: no shell is involved, so nothing
 * in a pattern or a path can be interpreted as a shell metacharacter.
 */
const ROOT = resolve(process.cwd(), "../..");

/** Suites whose JOB is to name a removed symbol in an absence assertion — never drift. */
const ABSENCE_GUARDS = [
  "guardrail-subname.test.ts",
  "no-subname-surface.test.ts",
  "no-subname-exports.test.ts",
  "package-edges.test.ts",
  "custody-surface.test-d.ts",
  "custody.test.ts",
];

/**
 * Drop prose. A removed API legitimately appears in a sentence that says it was removed ("there is
 * no client.registerSubname verb"), and no grep can tell that apart from an instruction to use it.
 * So the verb/namespace guards below look at CODE only; doc drift is caught in review. The package
 * -name guards keep their .md coverage, because a deleted package name should appear NOWHERE.
 */
function codeOnly(lines: string[]): string[] {
  return lines
    .filter((l) => !l.split(":", 1)[0].endsWith(".md"))
    .filter((l) => {
      const body = l.replace(/^[^:]*:\d+:/, "").trim();
      return !body.startsWith("*") && !body.startsWith("//") && !body.startsWith("/*");
    });
}

function grepRepo(pattern: string): string[] {
  try {
    const out = execFileSync(
      "grep",
      ["-rIn", "--exclude-dir=node_modules", "--exclude-dir=dist", "--exclude-dir=.git", "-E", pattern,
        `${ROOT}/packages`, `${ROOT}/examples`],
      { encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean).filter((l) => !ABSENCE_GUARDS.some((g) => l.includes(g)));
  } catch (e) {
    // grep exits 1 for "no matches" — that is a PASS here, not a failure. Any other status is real.
    const status = (e as { status?: number }).status;
    if (status === 1) return [];
    throw e;
  }
}

describe("#6 guardrail: the subname spin-out holds", () => {
  it("no package imports or documents the deleted avokname package", () => {
    expect(grepRepo("@avokjs/avokname")).toEqual([]);
  });

  it("no package imports or documents the deleted rpc-proxy package", () => {
    expect(grepRepo("@avokjs/rpc-proxy")).toEqual([]);
  });

  it("only the examples depend on the subnames add-on", () => {
    // WHY: THE acceptance. Any core package gaining this edge makes the add-on mandatory again
    // and silently undoes the sub-project.
    const hits = grepRepo('"@avokjs/subnames"')
      .filter((l) => l.includes("package.json"))
      .filter((l) => !l.includes("/examples/"))
      .filter((l) => !l.includes("packages/subnames/package.json"));
    expect(hits).toEqual([]);
  });

  it("the core exposes no register verbs", () => {
    const hits = codeOnly(grepRepo("registerSubname|registerSolanaName|useRegisterSubname|useSubnameAvailability"))
      .filter((l) => !l.includes("/packages/subnames/"));
    expect(hits).toEqual([]);
  });

  it("the core client has no subname namespace", () => {
    const hits = codeOnly(grepRepo("client\\.subname\\.|\\.subname\\.(isAvailable|resolveName|mintFee)"));
    expect(hits).toEqual([]);
  });

  it("the add-on never sends — it only builds", () => {
    // WHY: the property that lets the add-on be optional. The moment it sends, it needs a send
    // seam from the core, and #3/#4's deletions start unravelling.
    const hits = grepRepo("\\.send\\(|sendTransaction\\(")
      .filter((l) => l.includes("/packages/subnames/src/"));
    expect(hits).toEqual([]);
  });
});
