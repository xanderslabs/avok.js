import { defineConfig } from "tsup";

// Shared-origin client: lightweight browser/RN-compatible chunk.
// Externalise viem (consumer-installed); no server deps.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "browser",
  dts: { resolve: true },
  sideEffects: false,
  treeshake: true,
  external: ["viem", /^viem\//, /^node:/],
});
