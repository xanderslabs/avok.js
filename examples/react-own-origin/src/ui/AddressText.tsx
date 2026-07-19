import { useState } from "react";
import { Icon } from "./Icon.js";

function truncateAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * Mono-rendered address. `truncate` (default true) shortens for display;
 * consent surfaces pass `truncate={false}` to show the full address. `copy`
 * adds a copy affordance.
 */
export function AddressText({
  address,
  truncate = true,
  copy = false,
}: {
  address: string;
  truncate?: boolean;
  copy?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function doCopy() {
    try {
      await navigator.clipboard?.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — no-op in the demo */
    }
  }

  return (
    <span className={truncate ? "addr" : "addr addr-full"}>
      {truncate ? truncateAddr(address) : address}
      {copy && (
        <button className={copied ? "addr-copy addr-copied" : "addr-copy"} onClick={doCopy} aria-label="Copy address">
          <Icon name={copied ? "check" : "copy"} size={12} />
        </button>
      )}
    </span>
  );
}
