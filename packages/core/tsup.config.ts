import { defineConfig } from "tsup";

// @avokjs/core — the framework-agnostic engine (wallet primitives, EVM + Solana tx, client,
// provider, shared-origin channel). Platform-neutral; the browser/RN platform adapters are injected
// by the facades. Deps stay external (resolved by the consumer or re-bundled by @avokjs/vanilla).
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
  ],
  format: ["esm"],
  platform: "neutral",
  dts: { resolve: true },
  sideEffects: false,
  treeshake: true,
  external: ["viem", /^viem\//],
});
