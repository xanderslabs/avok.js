import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const screensDir = join(import.meta.dirname, "..", "src", "screens");
const screens = readdirSync(screensDir).filter((f) => f.endsWith(".tsx"));

// The screens once hardcoded fontSize 31 times at 11px and 29 at 12px, while the token
// scale said body was 14px. That drift happened because there was no <Text> to route
// through. Now there is — this keeps it that way.
describe("screens spend the type scale instead of inventing sizes", () => {
  it("finds screens to check (guards against an empty glob passing vacuously)", () => {
    expect(screens.length).toBeGreaterThanOrEqual(6);
  });

  it.each(screens)("%s declares no raw fontSize", (file) => {
    const src = readFileSync(join(screensDir, file), "utf8");
    expect(src).not.toMatch(/fontSize\s*:/);
  });

  it.each(screens)("%s reads no theme scheme (colors come from CSS custom properties)", (file) => {
    const src = readFileSync(join(screensDir, file), "utf8");
    expect(src).not.toMatch(/\bscheme\./);
    expect(src).not.toMatch(/useTheme\s*\(/);
  });
});
