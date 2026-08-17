import { defineConfig } from "tsup";

// React Native facade: AvokProvider + hooks + native trio.
// react, react-native, and expo-secure-store are peer deps and must stay external.
// Platform: neutral (not browser) — this graph must not pull DOM/web-React.
//
// Nothing is bundled in: every @avokjs dependency of this package is published
// (@avokjs/core/engine, @avokjs/core/channel, @avokjs/contracts), so it stays external
// alongside the third-party runtime deps and the consumer installs it from npm.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "neutral",
  // Declarations come from `tsc --emitDeclarationOnly` (see package.json `build`), NOT from tsup.
  // tsup emits .d.ts via a vendored rollup-plugin-dts, which supports TypeScript <=6 only.
  dts: false,
  sideEffects: false,
  treeshake: true,
  external: [
    "react",
    "react/jsx-runtime",
    "react-dom",
    "react-native",
    "expo-secure-store",
    "viem",
    /^viem\//,
    /^node:/,
    /^@noble\//,
    /^@scure\//,
    "@avokjs/core/channel",
    "@avokjs/contracts",
  ],
});
