import { describe, it, expect } from "vitest";
import { VERSION } from "./index.js";
import pkg from "../../package.json" with { type: "json" };

describe("../../src/channel/index.js", () => {
  /**
   * WHY this compares against package.json rather than a literal.
   *
   * This test used to read `expect(VERSION).toBe("0.1.0")` — a hardcoded string asserted equal to a
   * hardcoded string. It could not fail. And it could not see the one thing it was nominally
   * guarding: changesets bumps package.json and nothing bumps the constant, so the first release
   * would have made `VERSION` a lie while this stayed green forever.
   *
   * Compared against the manifest, it fails the moment they part company — which is the only moment
   * it was ever needed.
   *
   * The constant is KEPT rather than deleted because this package is published (`private: false`):
   * removing a public export is a breaking change. Its private siblings (txengine, solana-txengine)
   * had theirs dropped outright, precisely because nothing outside could depend on them.
   */
  it("VERSION matches package.json — a release must not leave the constant behind", () => {
    expect(VERSION).toBe(pkg.version);
  });
});
