import { el } from "../core/el.js";

/**
 * Renders human-readable consent lines in a mono card. Lines carrying a ⚠
 * marker (raw/approve-unlimited/authorization) are tinted caution. Text is
 * rendered as plain text nodes — never innerHTML — so nothing in a line can
 * inject markup.
 */
export function ConsentLines({ lines }: { lines: string[] }): HTMLElement {
  return el(
    "div",
    { class: "consent" },
    lines.map((line) => el("div", { class: line.includes("⚠") ? "consent-caution" : undefined }, line)),
  );
}
