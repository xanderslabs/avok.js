import { type ElChild, el } from "../core/el.js";

export function EmptyState(o?: { loading?: boolean } | null, ...children: ElChild[]): HTMLElement {
  return el("div", { class: "empty-state" }, o?.loading ? "Loading…" : children);
}
