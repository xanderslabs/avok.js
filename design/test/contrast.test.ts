import { describe, it, expect } from "vitest";
import { palette, type Scheme } from "../src/index.js";

// WCAG 2.1 relative luminance + contrast ratio.
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linearize = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const AA_TEXT = 4.5; // WCAG AA, normal-size text
const AA_NON_TEXT = 3; // WCAG AA, focus rings and other non-text UI

// Why this test exists: pinning hex values proves WHAT a color is, not that it is
// legible. A palette edit that keeps the "brand" but drops a pair below AA is the
// failure we actually care about — it shipped once already (dark danger button at
// 2.77:1, white on #F87171, which also reached the origin's popups via .avok-btn--danger).
describe.each([
  ["light", palette.light],
  ["dark", palette.dark],
])("%s scheme is legible", (_name, s: Scheme) => {
  it.each(["text", "text2", "text3", "success", "danger", "caution"] as const)(
    "%s meets AA as body text on the page background",
    (key) => {
      expect(contrast(s[key], s.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it("semantic text stays legible on the raised surface too", () => {
    for (const key of ["success", "danger", "caution"] as const) {
      expect(contrast(s[key], s.bg2)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("the primary button's label is legible on its own fill", () => {
    expect(contrast(s.inkText, s.ink)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("the danger button's label is legible on its own fill", () => {
    // The regression: dark.onDanger was #FFFFFF on #F87171 = 2.77:1.
    expect(contrast(s.onDanger, s.danger)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("the accent is strong enough to be a focus ring against both surfaces", () => {
    expect(contrast(s.accent, s.bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrast(s.accent, s.bg2)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});
