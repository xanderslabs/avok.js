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
import { highestSeverity } from "./sign/consent-display.js";

export function createDomView(root: HTMLElement): AuthPopupView {
  function box(): HTMLDivElement {
    const d = document.createElement("div");
    d.style.font = "14px system-ui";
    d.style.padding = "20px";
    d.style.maxWidth = "380px";
    d.style.width = "100%";
    // The padding must sit INSIDE the max width, or the box is 420px in a 400px popup.
    d.style.boxSizing = "border-box";
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
      // A WAY OUT. This used to render bare text: no button, nothing to click, and the only exit was
      // the window's own chrome. It is a terminal screen, so it needs the one action that is still
      // available. It does not resolve anything, because nothing is waiting on it here.
      const d = box();
      const p = document.createElement("p");
      p.textContent = `Sign-in failed: ${msg}`;
      p.style.font = "16px system-ui";
      p.style.overflowWrap = "anywhere";
      d.appendChild(p);

      const close = document.createElement("button");
      close.textContent = "Close";
      close.onclick = () => window.close();
      d.appendChild(close);
      root.replaceChildren(d);
    },
    showConsent(lines, opts) {
      return new Promise<boolean>((resolve) => {
        const d = box();

        // WHO IS ASKING. The Vault serves any origin, so a screen that does not name the requester
        // is asking the user to approve an anonymous request. The origin comes from postMessage and
        // is browser-enforced, so it is one of the few things here nobody can forge.
        const who = document.createElement("div");
        who.textContent = opts?.requestOrigin
          ? `Request from ${opts.requestOrigin}`
          : "We can't tell you which site is asking.";
        who.style.fontSize = "12px";
        who.style.margin = "8px 0";
        who.style.color = opts?.requestOrigin ? "#3f3f46" : "#b91c1c";
        who.style.overflowWrap = "anywhere";
        d.appendChild(who);

        const title = document.createElement("div");
        title.textContent = "Signing request";
        title.style.fontWeight = "600";
        title.style.margin = "8px 0";
        d.appendChild(title);

        // ONE ELEMENT PER LINE, STYLED BY SEVERITY.
        //
        // Flattening every line into a single <pre> threw away the severity the decoder works out,
        // so the sentence explaining that a signature can drain your tokens rendered in the same
        // grey monospace as "nonce: 0". The model ranked; the view did not.
        //
        // Prose gets a readable sans face. Data keeps monospace, because an address is compared
        // character by character and a proportional font makes that harder.
        const body = document.createElement("div");
        body.style.background = "#f4f4f5";
        body.style.padding = "12px";
        body.style.borderRadius = "8px";
        body.style.maxWidth = "100%";
        body.style.boxSizing = "border-box";

        for (const line of lines) {
          if (line.text === "") {
            const spacer = document.createElement("div");
            spacer.style.height = "8px";
            body.appendChild(spacer);
            continue;
          }
          const el = document.createElement("div");
          el.textContent = line.text;
          el.style.overflowWrap = "anywhere";
          el.style.wordBreak = "break-word";
          el.style.maxWidth = "100%";
          el.style.boxSizing = "border-box";
          el.style.fontSize = "12px";
          el.style.lineHeight = "1.5";

          if (line.severity === "danger") {
            el.style.font = "600 13px system-ui";
            el.style.background = "#fee2e2";
            el.style.color = "#7f1d1d";
            el.style.border = "1px solid #fca5a5";
            el.style.borderRadius = "6px";
            el.style.padding = "8px 10px";
            el.style.margin = "0 0 8px";
          } else if (line.severity === "caution") {
            el.style.font = "500 12px system-ui";
            el.style.background = "#fef3c7";
            el.style.color = "#78350f";
            el.style.borderRadius = "6px";
            el.style.padding = "6px 8px";
            el.style.margin = "0 0 6px";
          } else {
            el.style.fontFamily = "ui-monospace, monospace";
            el.style.color = "#27272a";
          }
          body.appendChild(el);
        }
        d.appendChild(body);

        if (opts?.error) {
          const err = document.createElement("div");
          err.textContent = `Error: ${opts.error}`;
          err.style.color = "#b91c1c";
          err.style.fontSize = "12px";
          err.style.marginTop = "8px";
          err.style.overflowWrap = "anywhere";
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

          // WARN, NEVER BLOCK. A dangerous request stays approvable; what changes is that it cannot
          // be cleared by muscle memory in the place the ordinary button sits. The acknowledgement
          // is a second, different action, and it only ever ENABLES: it is added inside the
          // !rejectOnly branch, so a request that could not be decoded gains no route through.
          if (highestSeverity(lines) === "danger") {
            const ackRow = document.createElement("label");
            ackRow.style.display = "flex";
            ackRow.style.gap = "6px";
            ackRow.style.alignItems = "center";
            ackRow.style.fontSize = "12px";
            ackRow.style.margin = "10px 0 0";

            const ack = document.createElement("input");
            ack.type = "checkbox";
            const text = document.createElement("span");
            text.textContent = "I understand what this request does.";
            ackRow.append(ack, text);
            d.appendChild(ackRow);

            approve.disabled = true;
            ack.onclick = () => {
              approve.disabled = !ack.checked;
            };
          }

          actions.appendChild(approve);
        }

        d.appendChild(actions);
        root.replaceChildren(d);
      });
    },
  };
}
