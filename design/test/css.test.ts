import { describe, it, expect } from "vitest";
import { tokensCss, primitivesCss } from "../src/index.js";

describe("tokensCss", () => {
  const css = tokensCss();

  it("emits a :root block with light values", () => {
    expect(css).toContain(":root");
    expect(css).toContain("--color-bg: #FFFFFF");
    expect(css).toContain("--color-ink: #18181B");
    expect(css).toContain("--color-accent: #2563EB");
    expect(css).toContain("--radius-card: 9px");
    expect(css).toContain("--space-md: 12px");
  });

  it("emits a prefers-color-scheme:dark override", () => {
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("--color-bg: #18181B");
    expect(css).toContain("--color-accent: #7AA2FF");
  });

  it("uses the system font stack, never Geist (popups are CSP-locked)", () => {
    expect(css).toContain("--font-sans:");
    expect(css).not.toMatch(/Geist/);
  });

  it("contains no external load (CSP-safe)", () => {
    expect(css).not.toMatch(/https?:/);
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\(/);
  });
});

describe("primitivesCss", () => {
  const css = primitivesCss();

  it("defines the shared popup primitives", () => {
    for (const cls of [".avok-pop", ".avok-pop-h", ".avok-card", ".avok-kv",
      ".avok-amt", ".avok-acts", ".avok-btn", ".avok-btn--primary",
      ".avok-btn--secondary", ".avok-warning", ".avok-link"]) {
      expect(css).toContain(cls);
    }
  });

  it("references only token custom properties — no hardcoded hex", () => {
    expect(css).toMatch(/var\(--color-/);
    expect(css).not.toMatch(/#[0-9A-Fa-f]{3,6}/);
  });

  it("contains no external load (CSP-safe)", () => {
    expect(css).not.toMatch(/https?:/);
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\(/);
  });

  it("gives interactive elements a focus ring", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("var(--color-accent)");
  });

  it("tints the header icon with text color, not accent (accent = links/focus only)", () => {
    expect(css).toMatch(/\.avok-ic\s*\{[^}]*color:\s*var\(--color-text\)/);
    expect(css).not.toMatch(/\.avok-ic\s*\{[^}]*color:\s*var\(--color-accent\)/);
  });
});
