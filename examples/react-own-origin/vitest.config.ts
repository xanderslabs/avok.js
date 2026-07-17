import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The pure lib/ helpers are unit-tested, and the screens get a render smoke test:
// this demo is a 4-file-deep component tree with no other safety net, and its
// styling is being rewritten wholesale. A crash on mount must fail CI, not a human.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // Subname only renders its ENS/SNS toggle once a registrar is configured; with
    // neither set it early-returns a "set VITE_…" note instead, and the toggle
    // assertion would pass vacuously against that note's prose.
    env: {
      // config.ts throws at module-eval if VITE_RP_ID is unset (Home/Send import it), and
      // Home/Send are mounted by the smoke test — required here for the same reason it's
      // required in .env: a PRF evaluation is scoped to (credential, rpId), never inferred.
      VITE_RP_ID: "localhost",
      VITE_SUBNAME_REGISTRAR: "0x2222222222222222222222222222222222222222",
      VITE_SUBNAME_PARENT: "avok.eth",
      VITE_SNS_REGISTRAR: "AvokSNSRegistrar1111111111111111111111111111",
      VITE_SNS_PARENT: "avok.sol",
    },
  },
});
