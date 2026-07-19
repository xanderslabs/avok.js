import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const clientSrc = readFileSync(new URL("../../src/client/client.ts", import.meta.url), "utf8");
const typesSrc = readFileSync(new URL("../../src/types.ts", import.meta.url), "utf8");

describe("sdk-core has no subname surface (#6)", () => {
  it("does NOT depend on the subnames add-on or the old avokname package", () => {
    // WHY: ROADMAP #6's acceptance — the core SDK must build with the add-on UNINSTALLED.
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
    expect(deps).not.toContain("@avokjs/subnames");
    expect(deps).not.toContain("@avokjs/avokname");
  });

  it("client.ts imports nothing from the add-on", () => {
    expect(clientSrc).not.toMatch(/@avokjs\/(subnames|avokname)/);
  });

  it("exposes no register verbs and no subname namespace", () => {
    expect(clientSrc).not.toMatch(/registerSubname|registerSolanaName/);
    expect(typesSrc).not.toMatch(/registerSubname|registerSolanaName/);
  });

  it("ClientConfig carries no subname mint config", () => {
    // WHY: no surface => no config. A leftover field would imply a capability the core lost.
    for (const field of ["subnameRegistrar", "subnameParent", "subnameVoucherSigner", "snsRegistrar", "snsParent"]) {
      expect(typesSrc).not.toMatch(new RegExp(`\\b${field}\\??:`));
    }
  });

  it("Account carries no subname field", () => {
    // WHY: a name is add-on data, not wallet state (SPEC-06 §1.3).
    expect(typesSrc).not.toMatch(/subname\?:\s*string/);
  });
});
