import { resolve } from "node:path";
import { defineConfig } from "vite";

// Single-entry client build for the wallet-sandbox popup. A post-build script
// (scripts/inline-app.mjs) folds the entry's JS+CSS into ONE self-contained, CSP-safe HTML. No React
// plugin: the popup is plain-JS now (mountAuthPopup), so nothing here compiles JSX.
export default defineConfig({
  root: resolve(import.meta.dirname),
  build: {
    outDir: resolve(import.meta.dirname, "../app-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "index.html") },
    },
  },
});
