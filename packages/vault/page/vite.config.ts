import { resolve } from "node:path";
import { defineConfig } from "vite";

// Single-entry client build for the Vault page. `buildVault` folds the entry's JS and CSS into ONE
// self-contained, CSP-safe HTML file, so this config produces the intermediate the inliner consumes
// and nothing an operator deploys directly.
//
// `outDir` is deliberately absent: `buildVault` supplies a staging directory it also cleans up. No
// React plugin, because the page is plain JS (mountAuthPopup) and nothing here compiles JSX.
export default defineConfig({
  root: resolve(import.meta.dirname),
  build: {
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "index.html") },
    },
  },
});
