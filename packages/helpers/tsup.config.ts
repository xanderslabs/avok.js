import { defineConfig } from "tsup";

// Two entries: `.` (agnostic — no DOM/camera; RN/Node/browser) and `./qr` (browser-only:
// qrcode render + jsQR scan). Everything is a PUBLISHED dep (@avokjs/vanilla +
// contracts, viem, @solana/kit, qrcode, jsqr), so nothing is bundled — the consumer installs
// them. dts.resolve inlines local relative types; external published types are referenced as
// normal imports.
export default defineConfig({
  entry: { index: "src/index.ts", qr: "src/qr.ts" },
  format: ["esm"],
  platform: "browser",
  dts: { resolve: true },
  sideEffects: false,
  treeshake: true,
  clean: true,
  target: "es2022",
  external: [
    "viem",
    /^viem\//,
    /^node:/,
    /^@solana\//,
    /^@solana-program\//,
    "@solana-name-service/sns-sdk-kit",
    "@avokjs/vanilla",
    "@avokjs/contracts",
    "qrcode",
    "jsqr",
  ],
});
