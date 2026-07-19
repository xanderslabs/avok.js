import { el } from "../core/el.js";

/**
 * A tappable settings/action row: icon tile + title/desc + an optional end
 * adornment (badge, ↗ popup tag) and a chevron. `danger` tints the icon+title.
 */
export function ListRow({
  icon,
  title,
  desc,
  end,
  chevron = true,
  danger = false,
  onClick,
}: {
  icon?: Node;
  title: Node;
  desc?: Node;
  end?: Node;
  chevron?: boolean;
  danger?: boolean;
  onClick?: () => void;
}): HTMLElement {
  return el(
    "div",
    {
      class: onClick ? "list-row is-clickable" : "list-row",
      role: onClick ? "button" : undefined,
      onclick: onClick,
    },
    icon && el("span", { class: danger ? "list-icon is-danger" : "list-icon" }, icon),
    el(
      "div",
      { class: "list-body" },
      el("div", { class: danger ? "list-title is-danger" : "list-title" }, title),
      desc && el("div", { class: "list-desc" }, desc),
    ),
    el("div", { class: "list-end" }, end, chevron && onClick && el("span", { class: "list-chevron" }, "›")),
  );
}

/** The ↗ popup affordance used by shared-origin verb rows. */
export function PopupTag(): HTMLElement {
  return el("span", { class: "popup-tag" }, "↗ popup");
}

/** Small pill badge (e.g. "subname set"). */
export function Badge(text: string): HTMLElement {
  return el("span", { class: "badge" }, text);
}
