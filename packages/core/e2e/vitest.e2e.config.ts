import { defineConfig } from "vitest/config";

// Deliberately SEPARATE from the package's default `vitest run` (packages/core/package.json's `test`
// script), which only picks up `*.test.ts`. Files here are named `*.e2e.ts` so they are invisible to
// `pnpm test` / CI's default gate — live-chain and fork-chain legs are opt-in only, run explicitly
// via `vitest run --config e2e/vitest.e2e.config.ts`.
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.ts"],
    testTimeout: 6 * 60 * 60 * 1000, // the guardian-recovery leg carries a real 1h+ timelock wait
    hookTimeout: 120_000,
    fileParallelism: false, // live legs share one funded deployer nonce; run sequentially
  },
});
