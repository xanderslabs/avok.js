import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../../src/", import.meta.url).pathname;
const REPO = new URL("../../../../", import.meta.url).pathname;

/** Every file under `dir` whose extension is one a reader or a build actually consumes. */
function walk(dir: string, exts = [".ts"]): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, exts);
    return exts.some((e) => full.endsWith(e)) ? [full] : [];
  });
}

describe("EVM-only", () => {
  it("has no solana directory", () => {
    expect(() => statSync(join(SRC, "solana"))).toThrow();
  });

  it("imports nothing from a Solana package or module", () => {
    const offenders = walk(SRC).filter((f) =>
      /from\s+"(\.\.?\/)*solana\/|from\s+"@solana|from\s+"@solana-program|from\s+"@solana-name-service/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(offenders.map((f) => f.replace(SRC, ""))).toEqual([]);
  });

  // This scans source TEXT, so a stale comment describing machinery that no longer exists fails as
  // loudly as live code. That is intended: a comment about a deleted rail is drift, and this repo's
  // own history is about exactly that failure.
  //
  // It lands in Task 6 rather than Task 5 because Task 5 could not satisfy it: the four account
  // shapes still named Solana until the key container collapsed, and a guard that only a LATER
  // commit can turn green teaches the next person to loosen it.
  it("mentions Solana nowhere in src", () => {
    const offenders = walk(SRC).filter((f) => /solana|Solana|kora|Kora|\bSNS\b/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(SRC, ""))).toEqual([]);
  });

  // EVERYTHING ELSE A READER SEES. The guards above scan `src/`, which is why the rail survived in
  // docs/, landing/, the published package descriptions, and the renovate rules for two commits
  // after the code was gone. Those are not lesser surfaces: a package description is what npm
  // renders, and a docs page is what a developer reads before ever opening the source.
  it("mentions Solana nowhere a reader or an installer can see", () => {
    const targets = [
      ...walk(join(REPO, "docs"), [".mdx", ".json"]),
      ...walk(join(REPO, "landing"), [".html", ".md"]),
      join(REPO, "README.md"),
      join(REPO, "package.json"),
      join(REPO, "renovate.json"),
      ...["core", "react", "react-native"].map((p) => join(REPO, "packages", p, "package.json")),
      ...["core", "react", "react-native"].map((p) => join(REPO, "packages", p, "README.md")),
      join(REPO, "packages/core/SPONSORED.md"),
    ].filter((f) => existsSync(f));

    const offenders = targets.filter((f) => /solana|Solana|kora|Kora|\bSNS\b/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(REPO, ""))).toEqual([]);
  });
});
