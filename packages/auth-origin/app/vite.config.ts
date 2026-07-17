import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Client build for the origin-served shared-origin surfaces. Two entries; a post-build script
// (scripts/inline-app.mjs) folds each entry's JS+CSS into one self-contained HTML.
export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "../app-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        authorize: resolve(import.meta.dirname, "authorize.html"),
        sign: resolve(import.meta.dirname, "sign.html"),
      },
    },
  },
});
