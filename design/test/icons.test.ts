import { describe, it, expect } from "vitest";
import { renderIcon } from "../src/index.js";

describe("renderIcon", () => {
  it("returns an inline svg with currentColor stroke", () => {
    const svg = renderIcon("shield-check");
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('class="avok-ic"');
  });

  it("honors size + class overrides", () => {
    const svg = renderIcon("key-round", { size: 20, class: "hd" });
    expect(svg).toContain('width="20"');
    expect(svg).toContain('height="20"');
    expect(svg).toContain('class="hd"');
  });

  it("renders every named icon with path content and no external load", () => {
    for (const n of ["shield-check", "key-round", "triangle-alert", "download", "archive", "smartphone"] as const) {
      const svg = renderIcon(n);
      expect(svg).toMatch(/<(path|rect|circle)/);
      expect(svg).not.toMatch(/https?:/);
    }
  });

  it("escapes the class attribute so it can't break out of the attribute", () => {
    const svg = renderIcon("archive", { class: '"><script>alert(1)</script>' });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    // The opening <svg ...> tag must still be a single well-formed tag.
    expect(svg).toMatch(/^<svg [^>]*>/);
  });

  it("coerces a non-numeric size to a safe number (no raw interpolation)", () => {
    // A caller passing junk must not inject markup via the width/height attributes.
    const svg = renderIcon("archive", { size: "16\"><b" as unknown as number });
    expect(svg).not.toContain("<b");
    expect(svg).toMatch(/width="\d+"/);
    expect(svg).toMatch(/height="\d+"/);
  });
});
