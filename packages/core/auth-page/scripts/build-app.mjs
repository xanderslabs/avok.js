import { build } from "vite";
import { resolve } from "node:path";

// Build the single popup entry into ONE self-contained JS bundle (codeSplitting:false → no shared
// chunks, no modulepreload) that scripts/inline-app.mjs can fold into one HTML. The two entries
// (authorize + sign) collapsed into one wallet-sandbox page that dispatches on the request kind.
const APP = new URL("../app/", import.meta.url).pathname;
const OUT = new URL("../app-dist/", import.meta.url).pathname;

await build({
  root: APP,
  logLevel: "warn",
  build: {
    outDir: OUT,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(APP, "index.html"),
      output: { codeSplitting: false },
    },
  },
});
console.log("built index");
