import { el, svg } from "../core/el.js";

// The node/diamond mark: an ink tile with a rotated rounded-square glyph. The
// tile color comes from the .brand-mark class (var(--ink) / var(--ink-text));
// size-dependent geometry is applied inline.
export function BrandMark(size = 20): HTMLElement {
  const glyph = Math.round(size * 0.55);
  return el(
    "span",
    {
      class: "brand-mark",
      style: {
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${Math.round(size * 0.3)}px`,
      },
    },
    svg(
      "svg",
      { viewBox: "0 0 24 24", width: glyph, height: glyph, fill: "currentColor", "aria-hidden": "true" },
      svg("rect", { x: "7", y: "7", width: "10", height: "10", rx: "2.6", transform: "rotate(45 12 12)" }),
    ),
  );
}
