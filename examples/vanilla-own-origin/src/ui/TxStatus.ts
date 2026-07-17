import { el } from "../core/el.js";
import type { TxState } from "@avokjs/helpers";

export function TxStatus({
  state,
  explorerUrl,
}: {
  state: TxState;
  explorerUrl?: string;
}): HTMLElement | null {
  if (state === "idle") return null;
  const label: Record<Exclude<TxState, "idle">, string> = {
    signing: "Waiting for signature…",
    pending: "Submitted — confirming…",
    confirmed: "Confirmed",
    failed: "Failed",
  };
  return el(
    "div",
    { role: "status", "aria-live": "polite" },
    el("span", null, label[state]),
    explorerUrl && (state === "pending" || state === "confirmed")
      ? el("a", { href: explorerUrl, target: "_blank", rel: "noreferrer" }, " View on explorer ↗")
      : null,
  );
}
