import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Repo root = four levels up from this test file (packages/core/src/wallet).
const ROOT = join(import.meta.dirname, "../../../..");

function sources(): string[] {
  // Scan shipped source only — never dist/node_modules, and never tests (which now co-locate in src/;
  // this guard scans SHIPPED code, and a test's own check-pattern must not read as a violation).
  return globSync("{packages,examples}/**/src/**/*.{ts,tsx,mjs}", { cwd: ROOT })
    .concat(globSync("examples/**/*.mjs", { cwd: ROOT }))
    .map((p) => join(ROOT, p))
    .filter((p) => !p.includes("/dist/") && !p.includes("/node_modules/") && !/\.test(-d)?\.(ts|tsx)$/.test(p));
}

describe("subname is never conflated with a passkey label / networkName", () => {
  const files = sources();

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no source assigns an subname into networkName", () => {
    const offenders = files.filter((f) => /networkName:\s*subname\b/.test(readFileSync(f, "utf8")));
    expect(offenders, `conflation in:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no source builds a passkey label from an subname", () => {
    // handleLabel's first arg is the operator label; guard against `handleLabel(subname, …)`.
    const offenders = files.filter((f) => /handleLabel\(\s*subname\b/.test(readFileSync(f, "utf8")));
    expect(offenders, `conflation in:\n${offenders.join("\n")}`).toEqual([]);
  });
});
