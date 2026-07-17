/**
 * Web popup signing channel.
 *
 * Protocol summary:
 *   1. window.open(url) — opens a popup to ${authOrigin}/sign (sign) or req.url (authorize).
 *   2. popup.postMessage(req, expectedOrigin) — sends the ChannelRequest to the popup.
 *      The popup buffers this if it arrives before the page has set up its listener;
 *      real popup pages should handle early-arrival messages or signal readiness first.
 *   3. window "message" listener waits for a reply. SECURITY: only messages whose
 *      event.origin === new URL(authOrigin).origin AND event.source === popup (the exact
 *      window reference we opened) are accepted; all others are ignored.
 *   4. On accepted reply: resolves the promise, removes the listener.
 *   5. On 5-minute timeout or popup blocked: rejects, removes the listener.
 *
 * DEVICE/BROWSER-GATED:
 *   Opening a real popup and postMessage across real browsing contexts requires a
 *   live browser environment. Unit tests cover the message-protocol + origin-check
 *   + source-check + cleanup logic via a mocked window (see test/channels-web.test.ts).
 */

import type { SigningChannel, ChannelRequest, ChannelResult } from "./port.js";

/** How long to wait for the popup to reply before giving up. */
const POPUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function createWebChannel({ authOrigin }: { authOrigin: string }): SigningChannel {
  // Fix 2: Enforce secure transport at construction time.
  // authOrigin must be HTTPS. HTTP is only allowed for localhost development.
  const parsed = new URL(authOrigin);
  if (parsed.protocol !== "https:") {
    const h = parsed.hostname;
    const isLocalhost = h === "localhost" || h === "127.0.0.1" || h === "[::1]";
    if (!isLocalhost) {
      throw new Error(
        `createWebChannel: authOrigin must use HTTPS (got "${authOrigin}"). ` +
          `HTTP is only allowed for localhost development.`,
      );
    }
  }

  // Pre-compute once: the normalised origin we accept replies from.
  const expectedOrigin = parsed.origin;

  return {
    open(req: ChannelRequest): Promise<ChannelResult> {
      // NOTE: sessionId is intentionally NOT appended to the URL here — consistent
      // with how /sign already works on web. The web channel relies on postMessage
      // channel binding (event.source === popup) for request/reply correlation, so
      // the session does not need to travel in the redirect URL (unlike native, where
      // the redirect URL is the only communication channel back to the opener).
      const url = req.kind === "sign" ? `${authOrigin}/sign` : req.url;

      // DEVICE/BROWSER-GATED: requires a real browser.
      const popup = window.open(url, "_blank", "popup,width=480,height=640");

      if (!popup) {
        return Promise.reject(new Error("Popup blocked: window.open returned null"));
      }

      return new Promise<ChannelResult>((resolve, reject) => {
        let settled = false;
        let pollIntervalId: ReturnType<typeof setInterval> | undefined;

        function cleanup(): void {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          clearInterval(pollIntervalId);
          window.removeEventListener("message", handler);
          // popup is non-null here: we rejected above the Promise constructor if it were null.
          popup!.close();
        }

        function handler(event: MessageEvent): void {
          // Fix 1: Verify the message came from the exact popup we opened, not just any
          // window at the same origin (sibling tabs, iframes, etc.).
          if (event.source !== popup) return;

          // SECURITY: reject messages from any origin other than the auth origin.
          if (event.origin !== expectedOrigin) return;

          // Fix 3: Defensively validate the reply shape before resolving.
          // A message with a missing or garbage kind must be ignored.
          const data: unknown = event.data;
          if (typeof data !== "object" || data === null) return;
          const kind = (data as Record<string, unknown>)["kind"];

          // READY HANDSHAKE. The eager postMessage below fires in the same task as window.open(),
          // when the popup is still an empty about:blank document — postMessage is NOT queued for a
          // document that hasn't loaded, so that first request was delivered into the void and lost.
          // The /sign popup, whose only source of the request IS this message, then sat on "Loading…"
          // forever and shared-origin signing could never complete. So the popup announces itself once
          // its listener is attached, and we re-send. (Idempotent: the popup ignores a duplicate
          // request once one is pending, and /authorize never sends `ready` — it reads its params
          // from the URL — so it is unaffected by any of this.)
          if (kind === "ready") {
            popup!.postMessage(req, expectedOrigin);
            return;
          }

          if (kind !== "sign" && kind !== "authorize") return;

          cleanup();
          resolve(event.data as ChannelResult);
        }

        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error("Popup timed out: no reply received within the allowed window"));
        }, POPUP_TIMEOUT_MS);

        // Early-close detection: poll every 500 ms so we don't hang the full 5 minutes
        // when the user manually dismisses the popup.
        //
        // RACE GUARD: when the popup posts a valid result and immediately closes itself,
        // both the "message" event task and this close detection can race. We defer the
        // reject by one macrotask (setTimeout 0) so any already-queued "message" task
        // runs first — if it resolves (setting settled=true) the deferred reject is a
        // no-op. We also clear the interval immediately to prevent repeat scheduling.
        pollIntervalId = setInterval(() => {
          if (popup!.closed) {
            clearInterval(pollIntervalId);
            setTimeout(() => {
              if (settled) return;
              cleanup();
              reject(new Error("Signing popup was closed"));
            }, 0);
          }
        }, 500);

        window.addEventListener("message", handler);

        // Send the request to the popup. The popup must echo the result back via
        // postMessage to its opener. We target expectedOrigin for delivery security.
        popup.postMessage(req, expectedOrigin);
      });
    },
  };
}
