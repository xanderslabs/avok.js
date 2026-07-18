import { defineConfig } from "vitest/config";

// The shared lib/ helpers now live in @avokjs/core/helpers (tested there); this demo's
// UI is a typecheck + build target, not a vitest target — so it has no local unit tests.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
