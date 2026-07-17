import { el } from "../core/el.js";

export function TokenRow({
  symbol,
  name,
  chain,
  amount,
  usd,
  glyph,
  first,
}: {
  symbol: string;
  name: string;
  chain: string;
  amount: string;
  usd?: string;
  glyph?: string;
  first?: boolean;
}): HTMLElement {
  return el(
    "div",
    { class: first ? "token-row is-first" : "token-row" },
    el("span", { class: "token-glyph" }, glyph ?? symbol.slice(0, 1)),
    el(
      "div",
      null,
      el("div", { class: "token-name" }, name),
      el("div", { class: "token-chain" }, chain),
    ),
    el(
      "div",
      { class: "token-end" },
      el("div", { class: "token-amount" }, amount),
      usd && el("div", { class: "token-usd" }, usd),
    ),
  );
}
