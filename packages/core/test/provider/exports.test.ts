import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../../package.json") as { exports: Record<string, unknown> };

describe("published surface", () => {
  // GUARD. v1 is EVM-only. These subpaths are how Solana reached consumers.
  it("publishes no Solana subpath", () => {
    expect(Object.keys(pkg.exports)).not.toContain("./solana");
  });

  it("publishes no ./decode subpath, which pointed at the Solana decoder", () => {
    expect(Object.keys(pkg.exports)).not.toContain("./decode");
  });

  it("still publishes the EVM surface", () => {
    for (const sub of [".", "./evm", "./provider", "./channel", "./wallet", "./auth-popup", "./qr"]) {
      expect(Object.keys(pkg.exports)).toContain(sub);
    }
  });
});
