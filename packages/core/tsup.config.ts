import { defineConfig } from "tsup";

// @avokjs/core — the framework-agnostic engine (wallet primitives, EVM + Solana tx, client,
// provider, shared-origin channel). Platform-neutral; the browser/RN platform adapters are injected
// by the facades. Deps stay external — @avokjs/core is published, so the consumer installs them.
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/engine.ts",
    "src/internal/index.ts",
    "src/solana/decode.ts",
    "src/wallet/index.ts",
    "src/evm/index.ts",
    "src/solana/index.ts",
    "src/channel/index.ts",
    "src/provider/index.ts",
    "src/helpers/index.ts",
    "src/helpers/qr.ts",
    "src/helpers/pairing-window.ts",
    "src/auth-popup/index.ts",
  ],
  format: ["esm"],
  platform: "neutral",
  // Declarations come from `tsc --emitDeclarationOnly` (see package.json `build`), NOT from tsup.
  // tsup emits .d.ts via a vendored rollup-plugin-dts, which supports TypeScript <=6 only.
  dts: false,
  sideEffects: false,
  treeshake: true,
  external: ["viem", /^viem\//],
});
