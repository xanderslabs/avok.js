import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";
import pkg from "../package.json" with { type: "json" };

describe("auth-origin", () => {
  /**
   * Compared against the manifest, not a literal. `expect(VERSION).toBe("0.1.0")` asserted a
   * hardcoded string equal to a hardcoded string: it could not fail, including on the one event it
   * was nominally there for — changesets bumps package.json, nothing bumps the constant, and the
   * first release makes `VERSION` a lie while the test stays green.
   *
   * Kept rather than deleted because this package is published; removing a public export is a
   * breaking change.
   */
  it("VERSION matches package.json — a release must not leave the constant behind", () => {
    expect(VERSION).toBe(pkg.version);
  });
});
