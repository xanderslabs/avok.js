import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("../../src/helpers/", import.meta.url).pathname;

describe("name resolution", () => {
  // Name RESOLUTION stays in scope (VISION section 6). Only the Solana namespace goes.
  it("resolves no .sol names", () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /sns|\.sol\b|solana/i.test(readFileSync(join(DIR, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
