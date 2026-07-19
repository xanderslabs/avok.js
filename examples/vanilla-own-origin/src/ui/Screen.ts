import { type ElChild, el } from "../core/el.js";

// A sub-screen body. Renders an optional in-body header (back ‹ + title) and
// the padded content area.
export function Screen(o: { title?: string; onBack?: () => void }, ...children: ElChild[]): HTMLDivElement {
  const { title, onBack } = o;
  return el(
    "div",
    null,
    (title || onBack) &&
      el(
        "div",
        { class: "screen-header" },
        onBack && el("button", { class: "screen-back", type: "button", "aria-label": "Back", onclick: onBack }, "‹"),
        title && el("span", { class: "screen-title" }, title),
      ),
    el("div", { class: "screen-body" }, ...children),
  );
}
