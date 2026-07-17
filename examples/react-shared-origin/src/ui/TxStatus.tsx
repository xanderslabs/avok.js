import type { TxState } from "@avokjs/helpers";
import { Text } from "./Text.js";

export function TxStatus({ state, explorerUrl }: { state: TxState; explorerUrl?: string }) {
  if (state === "idle") return null;
  const label: Record<Exclude<TxState, "idle">, string> = {
    signing: "Waiting for signature…",
    pending: "Submitted — confirming…",
    confirmed: "Confirmed",
    failed: "Failed",
  };
  const tone = state === "confirmed" ? "success" : state === "failed" ? "danger" : "subtle";
  return (
    <div role="status" aria-live="polite">
      <Text variant="label" tone={tone}>
        {label[state]}
      </Text>
      {explorerUrl && (state === "pending" || state === "confirmed") ? (
        <a href={explorerUrl} target="_blank" rel="noreferrer"> View on explorer ↗</a>
      ) : null}
    </div>
  );
}
