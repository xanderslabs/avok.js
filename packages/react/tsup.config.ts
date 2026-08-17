import { defineConfig } from "tsup";

// React facade: AvokProvider + hooks for web.
// react is a peer dep and must stay external.
// All @avokjs/* packages stay external so app bundlers can tree-shake.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "browser",
  // Declarations come from `tsc --emitDeclarationOnly` (see package.json `build`), NOT from tsup.
  // tsup emits .d.ts via a vendored rollup-plugin-dts, which supports TypeScript <=6 only.
  dts: false,
  sideEffects: false,
  treeshake: true,
  external: ["react", "react/jsx-runtime", "react-dom", "viem", /^viem\//, /^@avokjs\//, /^node:/],
});
