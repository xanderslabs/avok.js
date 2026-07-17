import { svg } from "../core/el.js";

// Inline Lucide-style glyphs for the demo, built as real SVG nodes so icons
// inherit `currentColor` and compose into buttons/rows without innerHTML. Each
// entry is a factory (fresh nodes per call — a DOM node has a single parent).

export type IconName =
  | "send"
  | "receive"
  | "copy"
  | "passkey"
  | "plus"
  | "import"
  | "device"
  | "accessSlot"
  | "key"
  | "external"
  | "check"
  | "logout";

const PATHS: Record<IconName, () => SVGElement[]> = {
  send: () => [svg("path", { d: "M6 13.5l6-6 6 6" }), svg("path", { d: "M12 7.5V19" })],
  receive: () => [svg("path", { d: "M18 10.5l-6 6-6-6" }), svg("path", { d: "M12 16.5V5" })],
  copy: () => [
    svg("rect", { x: "9", y: "9", width: "13", height: "13", rx: "2" }),
    svg("path", { d: "M5 15V5a2 2 0 0 1 2-2h10" }),
  ],
  passkey: () => [
    svg("path", { d: "M12 11v3" }),
    svg("path", { d: "M7 11a5 5 0 0 1 10 0" }),
    svg("path", { d: "M5 15a13 13 0 0 0 1 4" }),
    svg("path", { d: "M18 15a13 13 0 0 1-1 4" }),
  ],
  plus: () => [svg("path", { d: "M5 12h14" }), svg("path", { d: "M12 5v14" })],
  import: () => [
    svg("path", { d: "M12 3v12" }),
    svg("path", { d: "m8 11 4 4 4-4" }),
    svg("path", { d: "M20 21H4a2 2 0 0 1-2-2v-4" }),
  ],
  device: () => [
    svg("rect", { width: "14", height: "20", x: "5", y: "2", rx: "2" }),
    svg("path", { d: "M12 18h.01" }),
  ],
  accessSlot: () => [
    svg("rect", { width: "20", height: "5", x: "2", y: "3", rx: "1" }),
    svg("path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }),
    svg("path", { d: "M10 12h4" }),
  ],
  key: () => [
    svg("path", {
      d: "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",
    }),
    svg("circle", { cx: "16.5", cy: "7.5", r: ".5", fill: "currentColor" }),
  ],
  external: () => [svg("path", { d: "M7 17 17 7" }), svg("path", { d: "M8 7h9v9" })],
  check: () => [svg("path", { d: "M20 6 9 17l-5-5" })],
  logout: () => [
    svg("path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }),
    svg("path", { d: "m16 17 5-5-5-5" }),
    svg("path", { d: "M21 12H9" }),
  ],
};

export function Icon(name: IconName, size = 16): SVGElement {
  return svg(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
    PATHS[name](),
  );
}
