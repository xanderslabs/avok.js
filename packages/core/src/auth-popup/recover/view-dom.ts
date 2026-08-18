/**
 * The plain-DOM "Recover a wallet" screen — TDD §7's entire recovery UX, on the same one page the
 * signing/authorize ceremony lives on (`view-dom.ts`'s CSP discipline applies here too: styles set
 * PROGRAMMATICALLY, never as markup `style=`, so the emitted page stays hash-locked with no
 * `'unsafe-inline'`).
 *
 * Unlike `view-dom.ts`'s `showConsent` (one protocol message drives one screen), this view is USER
 * driven: it renders whatever `ceremony.getState()` currently is, and re-renders after every ceremony
 * method settles. There is no separate "controller" object — the view IS the loop, calling the pure
 * `RecoverCeremony` (see `ceremony.ts`) and repainting from its (new) state each time.
 */
import type { RecoverState } from "./ceremony.js";
import type { createRecoverCeremony } from "./ceremony.js";

type RecoverCeremony = ReturnType<typeof createRecoverCeremony>;

function box(): HTMLDivElement {
  const d = document.createElement("div");
  d.style.font = "14px system-ui";
  d.style.padding = "20px";
  d.style.maxWidth = "380px";
  d.style.width = "100%";
  d.style.boxSizing = "border-box";
  d.style.margin = "0 auto";
  return d;
}

function heading(text: string): HTMLDivElement {
  const h = document.createElement("div");
  h.textContent = text;
  h.style.fontWeight = "600";
  h.style.margin = "8px 0";
  return h;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function errorLine(message: string): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = message;
  el.style.color = "#b91c1c";
  el.style.fontSize = "12px";
  el.style.margin = "8px 0";
  el.style.overflowWrap = "anywhere";
  return el;
}

/** Human-readable "ready at" — `readyAt` is 0 until the threshold is met (contract's own "nothing
 *  scheduled yet" value), which is not a Unix epoch date worth showing. */
function readyAtText(readyAt: number): string {
  return readyAt === 0 ? "not yet (threshold not met)" : new Date(readyAt * 1000).toLocaleString();
}

function renderEnter(root: HTMLElement, ceremony: RecoverCeremony, rerender: () => void): void {
  const d = box();
  d.appendChild(heading("Recover a wallet"));
  const p = document.createElement("p");
  p.textContent = "Enter the wallet's address or ENS name.";
  d.appendChild(p);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "0x… or name.eth";
  input.style.width = "100%";
  input.style.boxSizing = "border-box";
  d.appendChild(input);

  d.appendChild(
    button("Recover", () => {
      void ceremony.enterWallet(input.value).then(rerender);
    }),
  );
  root.replaceChildren(d);
}

function renderResolving(root: HTMLElement): void {
  const d = box();
  d.appendChild(heading("Recover a wallet"));
  const p = document.createElement("p");
  p.textContent = "Looking up the wallet…";
  d.appendChild(p);
  root.replaceChildren(d);
}

function renderGuardianState(
  root: HTMLElement,
  ceremony: RecoverCeremony,
  state: Extract<RecoverState, { step: "guardian-state" }>,
  rerender: () => void,
): void {
  const d = box();
  d.appendChild(heading("Guardians"));

  const wallet = document.createElement("div");
  wallet.textContent = `Wallet: ${state.wallet}`;
  wallet.style.fontFamily = "ui-monospace, monospace";
  wallet.style.fontSize = "12px";
  wallet.style.overflowWrap = "anywhere";
  d.appendChild(wallet);

  const roster = document.createElement("div");
  roster.style.fontSize = "12px";
  roster.style.margin = "8px 0";
  roster.textContent = `${state.config.threshold} of ${state.config.guardians.length} guardian approval(s) needed. Guardians: ${state.config.guardians.join(", ")}`;
  d.appendChild(roster);

  if (state.pending) {
    const pending = state.pending;
    const p = document.createElement("div");
    p.style.background = "#fef3c7";
    p.style.color = "#78350f";
    p.style.borderRadius = "6px";
    p.style.padding = "8px";
    p.style.fontSize = "12px";
    p.style.margin = "8px 0";
    p.textContent =
      `A recovery is already pending: ${pending.approvals} of ${state.config.threshold} approvals, ` +
      `promoting ${pending.promoteKey}. Ready at: ${readyAtText(pending.readyAt)}. ` +
      "Any current full signer can veto it before then.";
    d.appendChild(p);
  }

  d.appendChild(
    button("Approve as a guardian", () => {
      void ceremony.beginApproval().then(rerender);
    }),
  );
  root.replaceChildren(d);
}

function renderApproving(
  root: HTMLElement,
  ceremony: RecoverCeremony,
  state: Extract<RecoverState, { step: "approving" }>,
  rerender: () => void,
): void {
  const d = box();
  d.appendChild(heading("Approve the recovery"));

  const promote = document.createElement("div");
  promote.style.fontFamily = "ui-monospace, monospace";
  promote.style.fontSize = "12px";
  promote.style.overflowWrap = "anywhere";
  promote.textContent = `This device's fresh key: ${state.promoteKey}`;
  d.appendChild(promote);

  if (state.error) d.appendChild(errorLine(state.error));

  d.appendChild(
    button("Connect a guardian wallet", () => {
      void ceremony.approveWithConnectedGuardian().then(rerender);
    }),
  );

  d.appendChild(heading("Or import a recovery key"));
  const keyInput = document.createElement("input");
  keyInput.type = "password";
  keyInput.placeholder = "0x… private key";
  keyInput.style.width = "100%";
  keyInput.style.boxSizing = "border-box";
  d.appendChild(keyInput);
  d.appendChild(
    button("Import & sign", () => {
      const value = keyInput.value as `0x${string}`;
      // Cleared immediately, win or lose — the function's own header documents it cannot wipe the
      // caller's string, so the caller (here) must not hold onto it any longer than the call needs.
      keyInput.value = "";
      void ceremony.approveWithImportedKey(value).then(rerender);
    }),
  );
  root.replaceChildren(d);
}

function renderSubmitted(root: HTMLElement, state: Extract<RecoverState, { step: "submitted" }>): void {
  const d = box();
  d.appendChild(heading("Approval signed"));
  const p = document.createElement("p");
  p.textContent = "This approval is ready to relay. Anyone can submit it on chain — the guardian pays no gas.";
  d.appendChild(p);

  const pre = document.createElement("pre");
  pre.style.background = "#f4f4f5";
  pre.style.padding = "12px";
  pre.style.borderRadius = "8px";
  pre.style.fontSize = "11px";
  pre.style.overflowWrap = "anywhere";
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = JSON.stringify(
    {
      guardian: state.approval.guardian,
      promoteKey: state.approval.promoteKey,
      nonce: state.approval.nonce.toString(),
      signature: state.approval.signature,
    },
    null,
    2,
  );
  d.appendChild(pre);
  root.replaceChildren(d);
}

function renderTerminalError(root: HTMLElement, state: Extract<RecoverState, { step: "error" }>): void {
  const d = box();
  d.appendChild(heading("Recover a wallet"));
  d.appendChild(errorLine(state.message));
  root.replaceChildren(d);
}

/** Mount the recovery screen into `root` and paint the ceremony's current state. Call `render()` again
 *  after any external state change (there is none today — the ceremony is the only state source). */
export function mountRecoverView(root: HTMLElement, ceremony: RecoverCeremony): void {
  function render(): void {
    const state = ceremony.getState();
    switch (state.step) {
      case "enter":
        renderEnter(root, ceremony, render);
        return;
      case "resolving":
        renderResolving(root);
        return;
      case "guardian-state":
        renderGuardianState(root, ceremony, state, render);
        return;
      case "approving":
        renderApproving(root, ceremony, state, render);
        return;
      case "submitted":
        renderSubmitted(root, state);
        return;
      case "error":
        renderTerminalError(root, state);
        return;
      default: {
        const _exhaustive: never = state;
        throw new Error(`Unknown recover step: ${(_exhaustive as { step: string }).step}`);
      }
    }
  }
  render();
}
