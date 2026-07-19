import { el } from "../core/el.js";

export function Button({
  variant = "primary",
  icon,
  label,
  onClick,
  disabled,
}: {
  variant?: "primary" | "ghost" | "danger";
  icon?: Node;
  label: string | Node;
  onClick?: () => void;
  disabled?: boolean;
}): HTMLButtonElement {
  return el("button", { class: `btn btn-${variant}`, type: "button", onclick: onClick, disabled }, icon, label);
}
