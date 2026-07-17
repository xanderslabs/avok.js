import { el } from "../core/el.js";

export function ChainSwitcher({
  chains,
  selected,
  onSelect,
}: {
  chains: { id: number; name: string }[];
  selected: number;
  onSelect: (id: number) => void;
}): HTMLElement {
  return el(
    "div",
    { class: "chains" },
    chains.map((c) =>
      el(
        "button",
        { class: c.id === selected ? "chain is-on" : "chain", type: "button", onclick: () => onSelect(c.id) },
        c.name,
      ),
    ),
  );
}
