import { el } from "../core/el.js";

/** Labelled text input (mono). Use `below` for a resolved-address / hint line. */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  below,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  below?: Node;
}): HTMLDivElement {
  return el(
    "div",
    { class: "field" },
    el("label", { class: "field-label" }, label),
    el("input", {
      class: "field-input",
      value,
      placeholder,
      oninput: (e: Event) => onChange((e.target as HTMLInputElement).value),
    }),
    below,
  );
}
