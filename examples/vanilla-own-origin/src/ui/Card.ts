import { type ElChild, el } from "../core/el.js";

export function Card(o?: { style?: Record<string, string | number> } | null, ...children: ElChild[]): HTMLDivElement {
  return el("div", { class: "card", style: o?.style }, ...children);
}
