import { describe, it, expect } from "vitest";
import { palette, radius, space, font, type } from "../src/index.js";

const KEYS = [
  "bg", "bg2", "border", "text", "text2", "text3",
  "ink", "inkText", "accent", "success", "danger", "onDanger", "caution",
] as const;

describe("palette", () => {
  it("light and dark define the same key set", () => {
    expect(Object.keys(palette.light).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(palette.dark).sort()).toEqual([...KEYS].sort());
  });

  it("every value is a hex color", () => {
    for (const scheme of [palette.light, palette.dark]) {
      for (const v of Object.values(scheme)) {
        expect(v).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it("pins the Signal Ink accent + Zinc base (spec anchors)", () => {
    expect(palette.light.ink).toBe("#18181B");
    expect(palette.light.accent).toBe("#2563EB");
    expect(palette.dark.accent).toBe("#7AA2FF");
    expect(palette.dark.bg).toBe("#18181B");
  });
});

describe("scales", () => {
  it("radius is the Balanced calibration", () => {
    expect(radius).toEqual({ outer: 12, card: 9, button: 8, input: 8 });
  });
  it("popup font stacks are system (no Geist)", () => {
    expect(font.sansSystem).not.toMatch(/Geist/);
    expect(font.sans).toMatch(/Geist/);
  });
  it("type scale exposes the amount emphasis size", () => {
    expect(type.amount.size).toBe(20);
    expect(space.md).toBe(12);
  });
});
