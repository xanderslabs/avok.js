import { defineConfig } from "tsup";

// React Native facade: AvokProvider + hooks + native trio.
// react, react-native, and expo-secure-store are peer deps and must stay external.
// Platform: neutral (not browser) — this graph must not pull DOM/web-React.
//
// The private @avokjs engines (sdk-core + wallet-core + the txengine/
// solana-txengine graph) are BUNDLED (noExternal) so the published package
// is self-contained (a stranger installs @avokjs/react-native without any
// unpublished workspace package; dts.resolve inlines their types). Only PUBLISHED
// @avokjs packages (shared-origin, contracts) and third-party runtime deps stay
// external — the consumer installs those from npm.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "neutral",
  dts: { resolve: true },
  sideEffects: false,
  treeshake: true,
  noExternal: [/^@avokjs\/(sdk-core|wallet-core|txengine|solana-txengine)$/],
  external: [
    "react",
    "react/jsx-runtime",
    "react-dom",
    "react-native",
    "expo-secure-store",
    "viem",
    /^viem\//,
    /^node:/,
    /^@solana\//,
    /^@solana-program\//,
    /^@noble\//,
    /^@scure\//,
    "micro-key-producer",
    "@avokjs/shared-origin",
    "@avokjs/contracts",
  ],
});
