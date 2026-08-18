// @vitest-environment node
//
// No DOM here, and jsdom's configured base URL breaks `import.meta.url` path resolution.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * WHY THIS PACKAGE DECLARES A DEPENDENCY IT NEVER IMPORTS.
 *
 * `@avokjs/react-native` has no `import` of `@noble/curves` anywhere in its own sources. Grep says it
 * is dead. Grep is wrong here, and this guard exists because that wrong conclusion has been reached
 * more than once.
 *
 * `@avokjs/core`'s built output imports it AT RUNTIME (it is not bundled — `@noble/curves` is not in
 * core's tsup `external` list, but tsup externalizes package.json dependencies by default regardless),
 * and this package's own tsup config leaves it unbundled too. On the web that is fine: `@avokjs/react`
 * declares only `@avokjs/core`, because a web bundler resolves a transitive dependency through the
 * dependency's own tree.
 *
 * React Native does not. Metro resolves from the app's perspective and does not hoist a transitive
 * dependency the way node and web bundlers do, so a package left undeclared here can fail to resolve
 * in a real RN app. Nothing in CI would catch that, because CI never runs Metro: the failure appears
 * on a device, at import time, in someone else's project.
 *
 * So the rule is: every bare module `@avokjs/core`'s dist imports must be reachable from this
 * package's own manifest. Removing one to tidy up is the mistake this test prevents.
 *
 * It does NOT say every declared dependency is needed. `@scure/bip39` and `micro-key-producer` were
 * declared here, imported by nothing, and absent from core's dist; they were removed, correctly.
 * `@noble/hashes` and `@scure/base` were declared for the same reason `@noble/curves` still is —
 * core's PRF-blob/HKDF machinery imported them at runtime — but the D8 key-model migration deleted
 * that machinery outright (wallet/crypto/blob.ts, slot-meta.ts, and friends are gone), and core's own
 * dist no longer imports either. Re-verified against the actual built dist (not grep) before cutting
 * them: this task's own "re-verify then cut" instruction, applied.
 */
const RN_PKG = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
const CORE_DIST = resolve(process.cwd(), "..", "core", "dist");

/** Every bare specifier the built core imports, reduced to its package name. */
function coreRuntimeImports(): string[] {
  const files = readdirSync(CORE_DIST).filter((f) => f.endsWith(".js"));
  const specifiers = new Set<string>();
  for (const f of files) {
    const src = readFileSync(join(CORE_DIST, f), "utf8");
    for (const m of src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith(".") || spec.startsWith("node:")) continue;
      // "@scope/name/deep/path.js" -> "@scope/name"; "pkg/sub" -> "pkg"
      const parts = spec.split("/");
      specifiers.add(spec.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]);
    }
  }
  return [...specifiers].sort();
}

describe("the React Native facade's runtime dependency graph", () => {
  const declared = new Set([...Object.keys(RN_PKG.dependencies ?? {}), ...Object.keys(RN_PKG.peerDependencies ?? {})]);

  it("core's dist was built, or this guard is vacuous", () => {
    expect(existsSync(CORE_DIST), "run `pnpm build` before this suite").toBe(true);
    expect(coreRuntimeImports().length).toBeGreaterThan(0);
  });

  it("declares every package @avokjs/core imports at runtime, so Metro can resolve them", () => {
    const missing = coreRuntimeImports()
      // Self-references resolve through this package's own dependency on core.
      .filter((p) => p !== "@avokjs/core")
      .filter((p) => !declared.has(p));
    expect(
      missing,
      "Metro does not hoist a transitive dependency. Anything core imports at runtime must be " +
        "declared here too, or it fails to resolve on a device and nothing in CI notices.",
    ).toEqual([]);
  });

  it("keeps @noble/curves, which looks dead but is not", () => {
    // Named explicitly so a future tidy-up reads the reason before deleting it.
    expect(
      declared.has("@noble/curves"),
      "@noble/curves is imported by @avokjs/core's dist and must stay declared here",
    ).toBe(true);
  });

  it("does NOT declare @noble/hashes or @scure/base — the D8 migration deleted the code that used them", () => {
    for (const p of ["@noble/hashes", "@scure/base"]) {
      expect(coreRuntimeImports(), `${p} should no longer appear in core's dist`).not.toContain(p);
      expect(declared.has(p), `${p} is dead — core's dist no longer imports it`).toBe(false);
    }
  });
});
