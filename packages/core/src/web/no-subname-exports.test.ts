import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vanilla from "../index.js";

// cwd, not import.meta.url: this suite runs in a jsdom environment, where import.meta.url is
// not a file: URL and `new URL(...)` would throw.
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

describe("vanilla re-exports no subname surface (#6)", () => {
  it("does not depend on the add-on", () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
    expect(deps).not.toContain("@avokjs/subnames");
    expect(deps).not.toContain("@avokjs/avokname");
  });

  it("re-exports no subname symbols", () => {
    // WHY: a facade re-export IS a dependency edge. Keeping fullName here would drag the
    // add-on back into the core's graph and undo the spin-out.
    for (const sym of [
      "normalizeSubname",
      "fullName",
      "voucherDomain",
      "signVoucher",
      "VOUCHER_TYPES",
      "recoverVoucherSigner",
    ]) {
      expect(vanilla).not.toHaveProperty(sym);
    }
  });
});
