import { build } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Build each entry INDEPENDENTLY (one input per build) so there are no shared chunks — each
// entry emits a single self-contained JS bundle that scripts/inline-app.mjs can fold into one
// HTML. (A multi-entry build would split common code into a shared chunk + modulepreload link,
// which the inliner can't follow.)
const APP = new URL("../app/", import.meta.url).pathname;
const OUT = new URL("../app-dist/", import.meta.url).pathname;
const ENTRIES = ["authorize", "sign"];

for (let i = 0; i < ENTRIES.length; i++) {
  const entry = ENTRIES[i];
  await build({
    root: APP,
    plugins: [react()],
    logLevel: "warn",
    build: {
      outDir: OUT,
      emptyOutDir: i === 0,
      rollupOptions: {
        // Single (string) input + codeSplitting:false → ONE self-contained JS chunk (no shared/
        // split chunks, no modulepreload) so the inliner can fold it into one HTML file.
        input: resolve(APP, `${entry}.html`),
        output: { codeSplitting: false },
      },
    },
  });
  console.log(`built ${entry}`);
}
