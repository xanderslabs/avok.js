import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

describe("helpers package edges (#6)", () => {
  it("NEVER depends on the subnames add-on", () => {
    // WHY: helpers is the resolution home and must work with the add-on uninstalled.
    // This edge is the one that would silently make the add-on mandatory again.
    const all = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.devDependencies });
    expect(all).not.toContain("@avokjs/subnames");
    expect(all).not.toContain("@avokjs/avokname");
  });

  it("does not HARD-depend on the vanilla facade", () => {
    // WHY: the only vanilla import is `import type` in pairing.ts — erased at build. A hard
    // dependency for two erased type imports forces the whole facade into the install graph.
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@avokjs/vanilla");
    expect(Object.keys(pkg.peerDependencies ?? {})).toContain("@avokjs/vanilla");
    expect(pkg.peerDependenciesMeta?.["@avokjs/vanilla"]?.optional).toBe(true);
  });
});
