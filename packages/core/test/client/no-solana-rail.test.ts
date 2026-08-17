import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SponsorshipUnavailableError } from "../../src/client/sponsorship-error.js";

const types = readFileSync(new URL("../../src/types.ts", import.meta.url).pathname, "utf8");

describe("the client rail", () => {
  it("configures no Kora endpoint", () => {
    expect(types).not.toMatch(/koraUrl/);
  });

  it("builds no Solana sponsorship error", () => {
    expect(SponsorshipUnavailableError).not.toHaveProperty("solana");
    expect(typeof SponsorshipUnavailableError.evm).toBe("function");
  });
});
