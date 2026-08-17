import { describe, it, expect } from "vitest";
import { runCli } from "../src/cli.js";

describe("runCli", () => {
  it("prints usage and exits non-zero when given no subcommand", async () => {
    const lines: string[] = [];
    const code = await runCli([], { log: (s) => lines.push(s) });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("avok-vault init");
  });

  it("exits non-zero on an unknown subcommand", async () => {
    const lines: string[] = [];
    const code = await runCli(["frobnicate"], { log: (s) => lines.push(s) });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("frobnicate");
  });
});
