import { defineConfig } from "tsup";

// Web facade: own-origin + lazy shared-origin.
//
// The private @avokjs engines (sdk-core + wallet-core + the txengine/oracle/
// subname/solana-txengine graph) are BUNDLED (noExternal) so the published package
// is self-contained — a stranger installs @avokjs/vanilla without needing any
// unpublished workspace package, and dts.resolve inlines their types into one
// self-contained index.d.ts. Only PUBLISHED @avokjs packages (network,
// contracts) and third-party runtime deps stay external — the consumer installs
// those from npm. The lazy shared-origin chunk (dynamic import of @avokjs/network)
// and the SNS mint chunk (dynamic import of @bonfida/@solana web3) stay external and
// code-split, so an own-origin-only / EVM-only app never loads them.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "browser",
  dts: { resolve: true },
  sideEffects: false,
  treeshake: true,
  noExternal: [/^@avokjs\/(sdk-core|wallet-core|subname|oracle|txengine|solana-txengine|provider)$/, /^@wallet-standard\//],
  external: [
    "viem",
    /^viem\//,
    /^node:/,
    /^@solana\//,
    /^@solana-program\//,
    /^@solana-name-service\//,
    /^@bonfida\//,
    /^@noble\//,
    /^@scure\//,
    "micro-key-producer",
    "@avokjs/network",
    "@avokjs/contracts",
  ],
});
