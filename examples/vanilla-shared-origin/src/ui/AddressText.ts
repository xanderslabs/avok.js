import { el } from "../core/el.js";
import { Icon } from "./Icon.js";

function truncateAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * Mono-rendered address. `truncate` (default true) shortens for display;
 * consent surfaces pass `truncate={false}` to show the full address. `copy`
 * adds a copy affordance (with a transient ✓ flash on click).
 */
export function AddressText({
  address,
  truncate = true,
  copy = false,
}: {
  address: string;
  truncate?: boolean;
  copy?: boolean;
}): HTMLElement {
  const span = el("span", { class: truncate ? "addr" : "addr addr-full" }, truncate ? truncateAddr(address) : address);

  if (copy) {
    let copied = false;
    const btn = el("button", { class: "addr-copy", type: "button", "aria-label": "Copy address" }, Icon("copy", 12));
    function render(): void {
      btn.replaceChildren(Icon(copied ? "check" : "copy", 12));
      btn.classList.toggle("is-copied", copied);
    }
    btn.onclick = async () => {
      try {
        await navigator.clipboard?.writeText(address);
        copied = true;
        render();
        setTimeout(() => {
          copied = false;
          render();
        }, 1200);
      } catch {
        /* clipboard unavailable — no-op in the demo */
      }
    };
    span.append(btn);
  }

  return span;
}
