import { defineConfig } from "tsup";

// Network-origin server: bundle the private @avokjs/* engine (incl. contracts ABI);
// auto-externalize runtime deps (@simplewebauthn/server, jose, viem) and node: built-ins
// so it ships standalone without workspace:* deps.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  // dts.resolve: true fully inlines all non-external types (the @avokjs/*
  // engine + its internal relative re-exports) into one self-contained index.d.ts.
  dts: { resolve: true },
  sideEffects: false,
  treeshake: true,
  noExternal: [/@avokjs\//],
  // Consumer-installed runtime deps: keep external.
  external: ["@simplewebauthn/server", "jose", "viem", /^node:/],
  esbuildOptions() {
    // tsup 8.5.1 does not expose a rollupOptions.onwarn passthrough: the tree-shaking
    // plugin hard-codes its rollup() call and only honours `silent` (which would suppress
    // all warnings). Narrowly intercept console.warn to filter rollup's
    // UNUSED_EXTERNAL_IMPORT for viem named imports that are transitively included by
    // inlined wallet-core but tree-shaken from the output (symbols are correctly absent
    // from dist/index.js). A beforeExit handler restores the original as best-effort
    // cleanup; the try-finally ensures restoration if option-setup itself throws.
    const orig = console.warn.bind(console);
    try {
      console.warn = (...args: unknown[]) => {
        const msg = typeof args[0] === "string" ? args[0] : "";
        // Match rollup UNUSED_EXTERNAL_IMPORT warning text. Both substrings must
        // be present to avoid swallowing unrelated warnings.
        if (msg.includes("imported from external module") && msg.includes("never used")) return;
        orig(...args);
      };
      process.once("beforeExit", () => {
        console.warn = orig;
      });
    } catch (e) {
      console.warn = orig;
      throw e;
    }
  },
});
