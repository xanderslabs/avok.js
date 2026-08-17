/**
 * Gesture-bound popup open with a retry prompt (TDD §4 popup-blocked fallback, rule one).
 *
 * `window.open` must run SYNCHRONOUSLY inside a user gesture handler to avoid the browser's popup
 * blocker in the normal case. If it still returns null (a hardened browser, a strict blocker
 * setting), the caller cannot just retry programmatically — calling `open` again from inside a
 * promise callback is no longer inside the gesture that triggered it, so it is blocked again the
 * same way. The only way out is a NEW gesture: this module renders a minimal "Continue in your
 * wallet" prompt whose click handler IS that new gesture, and calls `open` again from inside it.
 *
 * This module renders the retry prompt only. It does not decide whether to fall back further to a
 * full-page redirect (the `channels/native.ts` ceremony, `./redirect-protocol.ts`) — that decision
 * belongs to the caller, which knows which transport is available on the current platform.
 */

export type PopupOpenOutcome = { status: "opened"; popup: Window } | { status: "blocked" };

/** One attempt at `window.open`. A pure wrapper so callers (and tests) never touch the global directly. */
export function attemptPopupOpen(open: () => Window | null): PopupOpenOutcome {
  const popup = open();
  return popup ? { status: "opened", popup } : { status: "blocked" };
}

/**
 * Render the retry prompt into `root` after the first open attempt was blocked. Resolves with the
 * popup once a retry click succeeds. Never rejects on its own: a failed retry leaves the prompt up
 * so the user can click again, and the caller decides whether/when to give up.
 */
export function renderPopupRetryPrompt(root: HTMLElement, open: () => Window | null): Promise<Window> {
  return new Promise((resolve) => {
    root.innerHTML = "";
    const message = document.createElement("p");
    message.textContent = "Your browser blocked the wallet popup.";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Continue in your wallet";
    button.addEventListener("click", () => {
      // The click IS the gesture — this call to `open` is synchronous inside it, exactly like the
      // original attempt was inside whatever gesture triggered the caller in the first place.
      const outcome = attemptPopupOpen(open);
      if (outcome.status === "opened") resolve(outcome.popup);
      // Still blocked: leave the prompt up rather than giving up after one retry.
    });
    root.append(message, button);
  });
}
