import { defineConfig } from "vitest/config";

// This origin's suites run under vitest's default node environment (crypto, jose,
// http — none want a DOM). The app/ entries that remain (authorize, sign) are the
// shared-origin login + signing popups; they carry no component tests of their own, so
// there is no jsdom/React-plugin surface left here. All suites live under test/.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
