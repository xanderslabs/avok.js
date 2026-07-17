import { defineConfig } from "tsup";

// React facade: AvokProvider + hooks for web.
// react is a peer dep and must stay external.
// All @avokjs/* packages stay external so app bundlers can tree-shake.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "browser",
  dts: { resolve: true },
  sideEffects: false,
  treeshake: true,
  external: ["react", "react/jsx-runtime", "react-dom", "viem", /^viem\//, /^@avokjs\//, /^node:/],
});
