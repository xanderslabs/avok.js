import { el } from "../core/el.js";

export function AmountField({
  value,
  token,
  onChange,
  onMax,
  balanceLabel,
}: {
  value: string;
  token: string;
  onChange: (v: string) => void;
  onMax?: () => void;
  balanceLabel?: string;
}): HTMLDivElement {
  return el(
    "div",
    { class: "field" },
    el("label", { class: "field-label" }, "Amount"),
    el(
      "div",
      { class: "amount-box" },
      el("input", {
        class: "amount-input",
        value,
        inputMode: "decimal",
        placeholder: "0.00",
        oninput: (e: Event) => onChange((e.target as HTMLInputElement).value),
      }),
      el("span", { class: "amount-token" }, token),
    ),
    (balanceLabel || onMax) &&
      el(
        "div",
        { class: "amount-meta" },
        el("span", null, balanceLabel),
        onMax && el("button", { class: "amount-max", type: "button", onclick: onMax }, "Max"),
      ),
  );
}
