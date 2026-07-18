/**
 * The plain-DOM AuthPopupView — the wallet-sandbox popup's UI with no framework.
 *
 * This is what `mountAuthPopup` renders, and what the hardened-page emitter inlines. Styles are set
 * PROGRAMMATICALLY (`el.style.x = …`), never as markup `style=` attributes: a runtime DOM mutation is
 * not governed by the page's CSP `style-src`, so the emitted page stays hash-locked with no
 * `'unsafe-inline'`. (React did the same at runtime; this is the framework-free equivalent.)
 *
 * Visual parity with the old app/src/sign.tsx: a "Signing you in…" / "Waiting for passkey…" line for
 * the simple states, and a consent card (the decoded lines in a <pre> + Approve/Reject) for signing.
 */
import type { AuthPopupView } from "./ceremony.js";

export function createDomView(root: HTMLElement): AuthPopupView {
  function box(): HTMLDivElement {
    const d = document.createElement("div");
    d.style.font = "14px system-ui";
    d.style.padding = "20px";
    d.style.maxWidth = "380px";
    d.style.margin = "0 auto";
    return d;
  }

  function message(text: string): void {
    const d = box();
    const p = document.createElement("p");
    p.textContent = text;
    p.style.font = "16px system-ui";
    d.appendChild(p);
    root.replaceChildren(d);
  }

  return {
    connecting() {
      message("Signing you in…");
    },
    waitingForPasskey() {
      message("Waiting for passkey…");
    },
    failure(msg: string) {
      message(`Sign-in failed: ${msg}`);
    },
    showConsent(lines, opts) {
      return new Promise<boolean>((resolve) => {
        const d = box();

        const title = document.createElement("div");
        title.textContent = "Signing request";
        title.style.fontWeight = "600";
        title.style.margin = "8px 0";
        d.appendChild(title);

        const pre = document.createElement("pre");
        pre.textContent = lines.join("\n");
        pre.style.whiteSpace = "pre-wrap";
        pre.style.fontFamily = "monospace";
        pre.style.fontSize = "12px";
        pre.style.background = "#f4f4f5";
        pre.style.padding = "12px";
        pre.style.borderRadius = "8px";
        d.appendChild(pre);

        if (opts?.error) {
          const err = document.createElement("div");
          err.textContent = `Error: ${opts.error}`;
          err.style.color = "#b91c1c";
          err.style.fontSize = "12px";
          err.style.marginTop = "8px";
          d.appendChild(err);
        }

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.marginTop = "10px";

        const reject = document.createElement("button");
        // Reject is always available (a decode failure renders reject-only, labelled "Close").
        reject.textContent = opts?.rejectOnly ? "Close" : "Reject";
        reject.onclick = () => resolve(false);
        actions.appendChild(reject);

        if (!opts?.rejectOnly) {
          const approve = document.createElement("button");
          approve.textContent = "Approve";
          approve.onclick = () => resolve(true);
          actions.appendChild(approve);
        }

        d.appendChild(actions);
        root.replaceChildren(d);
      });
    },
  };
}
