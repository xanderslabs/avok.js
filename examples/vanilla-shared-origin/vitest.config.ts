import { defineConfig } from "vitest/config";

// The pure lib/ helpers, the pairing controller, and the core primitives
// (el/store) are unit-tested. The UI + screens are typecheck + build targets,
// not vitest targets. jsdom env is needed for the el() DOM helper tests.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
