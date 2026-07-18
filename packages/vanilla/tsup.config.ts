import { defineConfig } from "tsup";

// Web facade: own-origin + lazy shared-origin.
//
// The private @avokjs engines (sdk-core + wallet-core + the evm-txengine/
// solana-txengine graph) are BUNDLED (noExternal) so the published package
// is self-contained — a stranger installs @avokjs/vanilla without needing any
// unpublished workspace package, and dts.resolve inlines their types into one
// self-contained index.d.ts. Only PUBLISHED @avokjs packages (shared-origin,
// contracts) and third-party runtime deps stay external — the consumer installs
// those from npm. The lazy shared-origin chunk (dynamic import of @avokjs/core/channel)
// stays external and code-split, so an own-origin-only app never loads it.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "browser",
  dts: { resolve: true },
  sideEffects: false,
  treeshake: true,
  noExternal: [/^@avokjs\/core/, /^@wallet-standard\//],
  external: [
    "viem",
    /^viem\//,
    /^node:/,
    /^@solana\//,
    /^@solana-program\//,
    /^@noble\//,
    /^@scure\//,
    "micro-key-producer",
    "@avokjs/core/channel",
    "@avokjs/contracts",
  ],
});
