import { defineConfig } from "tsup";

// SDK core: platform-agnostic internal package.
// No node: imports, no DOM, no React/RN.
export default defineConfig({
  entry: ["src/index.ts", "src/internal/index.ts"],
  format: ["esm"],
  platform: "neutral",
  dts: { resolve: true },
  sideEffects: false,
  treeshake: true,
  external: ["viem", /^viem\//],
});
