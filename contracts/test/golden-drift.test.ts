import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import { GOLDEN } from "../script/deploy-canonical.mjs";
import { CHAIN_PROFILES } from "../src-ts/registry.js";

/**
 * The canonical implementation address is written down in THREE places:
 *   1. `GOLDEN` in script/deploy-canonical.mjs   (the deploy CLI's writeback gate)
 *   2. `GOLDEN_CANONICAL` in test/DeployCanonical.t.sol (the Solidity CREATE2 assertion)
 *   3. `canonicalImplementation` in src-ts/registry.ts  (what every wallet delegates to)
 *
 * They MUST agree. They once did not: a bytecode change moved the CREATE2 address, the Solidity test
 * and the registry followed, but the CLI's `GOLDEN` kept a stale value — and BOTH suites still passed,
 * because each only ever compared its own copy against itself. A deploy would then have been REJECTED
 * by assertGolden() even though it was correct. This test is the cross-check that closes that gap.
 */
function soliditySlot(): string {
  const sol = readFileSync(join(__dirname, "DeployCanonical.t.sol"), "utf8");
  const m = sol.match(/GOLDEN_CANONICAL\s*=\s*(0x[0-9a-fA-F]{40})/);
  if (!m) throw new Error("could not find GOLDEN_CANONICAL in DeployCanonical.t.sol");
  return getAddress(m[1]);
}

describe("canonical implementation address does not drift across its three homes", () => {
  it("deploy CLI GOLDEN === the Solidity GOLDEN_CANONICAL", () => {
    expect(getAddress(GOLDEN)).toBe(soliditySlot());
  });

  it("every EVM chain profile points at GOLDEN (or the explicit PENDING placeholder)", () => {
    const golden = getAddress(GOLDEN);
    const PENDING = getAddress("0x0000000000000000000000000000000000000000");
    for (const p of Object.values(CHAIN_PROFILES)) {
      if (p.kind !== "evm") continue;
      const impl = getAddress(p.canonicalImplementation);
      expect([golden, PENDING]).toContain(impl);
    }
  });
});
