import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("@avokjs/subnames package identity (#6)", () => {
  it("is named subnames, not avokname", () => {
    expect(pkg.name).toBe("@avokjs/subnames");
  });

  it("NEVER depends on the core SDK", () => {
    // WHY: the whole point of #6. The add-on must be installable/uninstallable without the
    // core, and the core must never gain an edge back. This is the acceptance, as a test.
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
    for (const forbidden of [
      "@avokjs/sdk-core",
      "@avokjs/vanilla",
      "@avokjs/react",
      "@avokjs/react-native",
      "@avokjs/provider",
      "@avokjs/network",
      "@avokjs/auth-origin",
    ]) {
      expect(deps).not.toContain(forbidden);
    }
  });

  it("may depend on helpers — the one-way edge", () => {
    expect(Object.keys(pkg.dependencies)).toContain("@avokjs/helpers");
  });
});
