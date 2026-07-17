import { describe, it, expect } from "vitest";
import { faviconSvg, faviconDataUri, faviconLinkTag } from "../src/index.js";

describe("faviconSvg (keyhole)", () => {
  const svg = faviconSvg();

  it("is a self-contained SVG with the svg namespace + viewBox", () => {
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it("draws a rounded node/diamond on a rounded tile (tile rect + rotated glyph rect)", () => {
    expect((svg.match(/<rect/g) ?? []).length).toBe(2);
    expect(svg).toContain("rotate(45 12 12)");
    expect(svg).toContain('rx="5.5"'); // rounded tile
  });

  it("is theme-aware: light + dark fills from the tokens", () => {
    expect(svg).toContain("@media (prefers-color-scheme: dark)");
    expect(svg).toContain("#18181B"); // ink
    expect(svg).toContain("#FAFAFA"); // paper
  });
});

describe("faviconDataUri", () => {
  it("is an inline, URL-encoded data URI (no raw # or spaces, no network load)", () => {
    const uri = faviconDataUri();
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    const payload = uri.slice("data:image/svg+xml,".length);
    expect(payload).not.toContain("#"); // encoded as %23
    expect(payload).not.toContain(" ");
    expect(payload).not.toMatch(/https?:\/\//); // xmlns is percent-encoded
  });
});

describe("faviconLinkTag", () => {
  it("is a rel=icon link pointing at the inline data URI", () => {
    const tag = faviconLinkTag();
    expect(tag).toContain('rel="icon"');
    expect(tag).toContain('type="image/svg+xml"');
    expect(tag).toContain('href="data:image/svg+xml,');
  });
});
