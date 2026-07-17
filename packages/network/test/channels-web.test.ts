/**
 * Unit tests for the web popup signing channel.
 *
 * WHAT IS TESTED HERE:
 *   - Origin validation: a message from the wrong origin is ignored.
 *   - Source validation: a message from a different window (not the popup) is ignored.
 *   - HTTPS enforcement: non-localhost HTTP authOrigin throws at construction.
 *   - Reply-shape guard: a message with a missing/garbage kind is ignored.
 *   - Correct-origin+source+kind message resolves the promise with the channel result.
 *   - Listener cleanup (removeEventListener) is called after resolution.
 *   - Popup blocked (null from window.open) rejects immediately.
 *   - Timeout rejects and cleans up after 5 minutes.
 *
 * DEVICE/BROWSER-GATED (NOT tested here):
 *   - Actually opening a real browser popup (window.open in a real browser).
 *   - The popup's own rendering and message-sending code.
 *   - postMessage across real browsing contexts.
 * All of the above require a live browser; these unit tests drive only the
 * message-protocol + origin-check + source-check logic via a mocked window.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWebChannel } from "../src/channels/web.js";
import type { ChannelResult } from "../src/channels/port.js";

const AUTH_ORIGIN = "https://auth.avok.test";
const WRONG_ORIGIN = "https://evil.example.com";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignRequest() {
  return {
    kind: "sign" as const,
    sessionId: "access-token-abc",
    request: { op: "signMessage" as const, message: "hello avok" },
  };
}

function makeSignResult(): ChannelResult {
  return { kind: "sign", result: { signature: "0xdeadbeef" as `0x${string}` } };
}

// ---------------------------------------------------------------------------
// Fake window setup
// ---------------------------------------------------------------------------

type MessageHandler = (event: Pick<MessageEvent, "origin" | "data" | "source">) => void;

let capturedMessageHandler: MessageHandler | null = null;
let removeListenerSpy: ReturnType<typeof vi.fn>;
let fakePopup: {
  postMessage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  closed: boolean;
};

/**
 * Set up a fake window. Pass `null` to simulate a blocked popup (window.open returns null).
 * By default window.open returns the freshly-created fakePopup.
 */
function setupFakeWindow(blockedPopup?: null) {
  capturedMessageHandler = null;
  removeListenerSpy = vi.fn();

  // Create fakePopup first so window.open can reference it.
  fakePopup = {
    postMessage: vi.fn(),
    close: vi.fn(),
    closed: false,
  };

  const openReturnValue = blockedPopup === null ? null : fakePopup;

  vi.stubGlobal("window", {
    open: vi.fn().mockReturnValue(openReturnValue),
    addEventListener: vi.fn((event: string, handler: MessageHandler) => {
      if (event === "message") capturedMessageHandler = handler;
    }),
    removeEventListener: removeListenerSpy,
  });
}

/**
 * Fire a synthetic message event. source defaults to fakePopup (the popup we opened)
 * so existing happy-path tests satisfy the Fix 1 source check automatically.
 */
function fireMessage(data: unknown, origin: string, source: unknown = fakePopup) {
  if (!capturedMessageHandler) throw new Error("No message handler was registered");
  // The stand-in `source` (the popup, a different window, etc.) plays the role of a
  // MessageEvent.source; cast at this fabrication boundary.
  capturedMessageHandler({ origin, data, source: source as MessageEventSource | null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createWebChannel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupFakeWindow(); // window.open → fakePopup by default
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves with the ChannelResult when a message arrives from the correct origin", async () => {
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });
    const expected = makeSignResult();

    const promise = channel.open(makeSignRequest());

    // Correct-origin reply (source defaults to fakePopup — the exact popup we opened)
    fireMessage(expected, AUTH_ORIGIN);

    const result = await promise;
    expect(result).toEqual(expected);
    expect(fakePopup.close).toHaveBeenCalled();
  });

  it("removes the message listener after a successful reply (cleanup)", async () => {
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });

    const promise = channel.open(makeSignRequest());
    fireMessage(makeSignResult(), AUTH_ORIGIN);
    await promise;

    expect(removeListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("ignores a message from a wrong origin — promise stays pending and eventually times out", async () => {
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });

    const promise = channel.open(makeSignRequest());

    // Fire wrong-origin message — must not resolve the promise
    fireMessage(makeSignResult(), WRONG_ORIGIN);

    // Verify still pending: attach a flag, flush microtasks
    let settled = false;
    promise.then(() => { settled = true; }).catch(() => { settled = true; });
    await Promise.resolve(); // flush one microtask tick
    expect(settled).toBe(false);

    // Advance past the 5-minute timeout — the promise should now reject (not resolve with the evil data)
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await expect(promise).rejects.toThrow(/timed out/i);
  });

  it("rejects immediately when window.open returns null (popup blocked)", async () => {
    setupFakeWindow(null); // simulate blocked popup
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });

    await expect(channel.open(makeSignRequest())).rejects.toThrow(/blocked/i);
  });

  it("rejects after 5 minutes with no reply and removes the listener (timeout cleanup)", async () => {
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });

    const promise = channel.open(makeSignRequest());

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    await expect(promise).rejects.toThrow(/timed out/i);
    expect(removeListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));
    expect(fakePopup.close).toHaveBeenCalled();
  });

  it("posts the request to the popup after opening it", async () => {
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });
    const req = makeSignRequest();

    const promise = channel.open(req);
    // Resolve to clean up
    fireMessage(makeSignResult(), AUTH_ORIGIN);
    await promise;

    expect(fakePopup.postMessage).toHaveBeenCalledWith(req, new URL(AUTH_ORIGIN).origin);
  });

  // The eager post above lands while the popup is still an unloaded about:blank document, and
  // postMessage does NOT queue for such a document — so it is silently dropped and the popup, whose
  // ONLY source of the request is that message, hangs on "Loading…" forever. That is exactly how
  // shared-origin signing failed in live testing. The popup therefore posts {kind:"ready"} once its
  // listener is attached, and we re-send.
  describe("ready handshake", () => {
    it("re-sends the request when the popup announces it is listening", async () => {
      const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });
      const req = makeSignRequest();

      const promise = channel.open(req);
      expect(fakePopup.postMessage).toHaveBeenCalledTimes(1); // the eager (lost) post

      fireMessage({ kind: "ready" }, AUTH_ORIGIN);
      expect(fakePopup.postMessage).toHaveBeenCalledTimes(2); // re-sent, now that it can be heard
      expect(fakePopup.postMessage).toHaveBeenLastCalledWith(req, new URL(AUTH_ORIGIN).origin);

      fireMessage(makeSignResult(), AUTH_ORIGIN);
      await promise;
    });

    it("does not settle on ready — it is a handshake, not a result", async () => {
      const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });
      const promise = channel.open(makeSignRequest());
      let settled = false;
      void promise.then(() => (settled = true)).catch(() => (settled = true));

      fireMessage({ kind: "ready" }, AUTH_ORIGIN);
      await Promise.resolve();
      expect(settled).toBe(false);

      fireMessage(makeSignResult(), AUTH_ORIGIN);
      await expect(promise).resolves.toEqual(makeSignResult());
    });

    // `ready` triggers an outbound send, so it must clear the same source/origin checks as a result —
    // otherwise any page could provoke us into re-posting the request somewhere.
    it("ignores a ready from the wrong origin", async () => {
      const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });
      const promise = channel.open(makeSignRequest());
      expect(fakePopup.postMessage).toHaveBeenCalledTimes(1);

      fireMessage({ kind: "ready" }, WRONG_ORIGIN);
      expect(fakePopup.postMessage).toHaveBeenCalledTimes(1); // not re-sent

      fireMessage(makeSignResult(), AUTH_ORIGIN);
      await promise;
    });

    it("ignores a ready from a window that is not our popup", async () => {
      const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });
      const promise = channel.open(makeSignRequest());
      expect(fakePopup.postMessage).toHaveBeenCalledTimes(1);

      fireMessage({ kind: "ready" }, AUTH_ORIGIN, { notThePopup: true });
      expect(fakePopup.postMessage).toHaveBeenCalledTimes(1); // not re-sent

      fireMessage(makeSignResult(), AUTH_ORIGIN);
      await promise;
    });
  });

  it("opens the popup to authOrigin/sign for a sign request", async () => {
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });

    const promise = channel.open(makeSignRequest());
    fireMessage(makeSignResult(), AUTH_ORIGIN);
    await promise;

    const openSpy = (window as unknown as { open: ReturnType<typeof vi.fn> }).open;
    const openedUrl: string = openSpy.mock.calls[0][0];
    expect(openedUrl).toContain(`${AUTH_ORIGIN}/sign`);
  });

  it("opens the popup to req.url for an authorize request", async () => {
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });
    const authorizeUrl = `${AUTH_ORIGIN}/authorize?response_type=code&state=abc`;

    const promise = channel.open({ kind: "authorize", url: authorizeUrl });
    fireMessage({ kind: "authorize", code: "auth-code", state: "abc" }, AUTH_ORIGIN);
    await promise;

    const openSpy = (window as unknown as { open: ReturnType<typeof vi.fn> }).open;
    const openedUrl: string = openSpy.mock.calls[0][0];
    expect(openedUrl).toBe(authorizeUrl);
  });

  // -------------------------------------------------------------------------
  // Fix 1: event.source check
  // -------------------------------------------------------------------------

  it("Fix 1 — ignores a correct-origin message from a DIFFERENT source (not our popup)", async () => {
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });

    const promise = channel.open(makeSignRequest());

    // Correct origin, but source is a different window — not the popup we opened.
    const differentWindow = { postMessage: vi.fn(), close: vi.fn(), closed: false };
    fireMessage(makeSignResult(), AUTH_ORIGIN, differentWindow);

    // Promise must remain pending
    let settled = false;
    promise.then(() => { settled = true; }).catch(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    // Clean up by timing out
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await expect(promise).rejects.toThrow(/timed out/i);
  });

  // -------------------------------------------------------------------------
  // Fix 2: HTTPS enforcement
  // -------------------------------------------------------------------------

  it("Fix 2 — throws at construction for a non-localhost HTTP authOrigin", () => {
    expect(() => createWebChannel({ authOrigin: "http://evil.example.com" })).toThrow(
      /must use HTTPS/i,
    );
  });

  it("Fix 2 — does NOT throw for http://localhost (dev allowance)", () => {
    expect(() => createWebChannel({ authOrigin: "http://localhost:3000" })).not.toThrow();
  });

  it("Fix 2 — does NOT throw for an https authOrigin", () => {
    expect(() => createWebChannel({ authOrigin: "https://auth.avok.test" })).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Fix 3: reply-shape guard
  // -------------------------------------------------------------------------

  it("Fix 3 — ignores a correct-origin+source message with a missing/garbage kind", async () => {
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });

    const promise = channel.open(makeSignRequest());

    // Correct origin + correct source, but kind is garbage
    fireMessage({ kind: "unexpected-garbage", payload: 42 }, AUTH_ORIGIN);

    let settled = false;
    promise.then(() => { settled = true; }).catch(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    // Clean up
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await expect(promise).rejects.toThrow(/timed out/i);
  });

  it("Fix 3 — ignores a null reply (non-object message data)", async () => {
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });

    const promise = channel.open(makeSignRequest());

    // null data — must not resolve the promise
    fireMessage(null, AUTH_ORIGIN, fakePopup);

    let settled = false;
    promise.then(() => { settled = true; }).catch(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    // Clean up
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await expect(promise).rejects.toThrow(/timed out/i);
  });

  // -------------------------------------------------------------------------
  // H3: early popup-close detection
  // -------------------------------------------------------------------------

  it("H3 — rejects with 'Signing popup was closed' when the popup is closed before reply", async () => {
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });

    const promise = channel.open(makeSignRequest());

    // Simulate the user manually closing the popup.
    fakePopup.closed = true;

    // Advance past the 500ms poll interval; the deferred setTimeout(0) also fires within
    // this advance (scheduled at t=500, fires at t=500 which is within t+501).
    vi.advanceTimersByTime(501);

    await expect(promise).rejects.toThrow(/signing popup was closed/i);
    // Cleanup should have been called: listener removed.
    expect(removeListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));

    // Settle-once: advance another full interval — the interval was cleared immediately
    // on close detection, so no further deferred rejects are scheduled; popup.close()
    // was called exactly once (idempotent cleanup).
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(fakePopup.close).toHaveBeenCalledTimes(1);
  });

  it("H3 — valid message wins the popup-close race (deferred reject is a no-op)", async () => {
    // This test proves the race fix: when the popup sends a valid result AND closes in
    // the same ~500ms window, the valid message must win and the promise must RESOLVE,
    // not reject with "Signing popup was closed".
    //
    // Setup: mark the popup as closed, then fire the valid message synchronously
    // (simulating the message arriving in the task queue before the deferred reject runs).
    // When we advance timers, the interval detects the closed popup and schedules a
    // deferred setTimeout(0) reject — but by then settled=true, so it is a no-op.
    const channel = createWebChannel({ authOrigin: AUTH_ORIGIN });
    const expected = makeSignResult();

    const promise = channel.open(makeSignRequest());

    // 1. Popup closes (sets closed=true).
    fakePopup.closed = true;

    // 2. Valid message arrives (fires the handler synchronously → cleanup → resolve →
    //    settled=true). This represents the postMessage task that was already queued
    //    before the deferred close-reject gets a chance to run.
    fireMessage(expected, AUTH_ORIGIN, fakePopup);

    // 3. Advance past the poll interval. cleanup() (run synchronously during the
    //    valid message in step 2) already cleared the interval, so advancing timers
    //    schedules nothing new; even if a deferred close-reject were pending it would
    //    find settled=true and return immediately.
    vi.advanceTimersByTime(501);
    await Promise.resolve();

    // The promise must resolve with the valid result — NOT reject with "popup closed".
    const result = await promise;
    expect(result).toEqual(expected);
    // Cleanup ran exactly once (idempotent — the deferred reject path was a no-op).
    expect(fakePopup.close).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Fix 2: localhost 127.0.0.1 variant
  // -------------------------------------------------------------------------

  it("Fix 2 — does NOT throw for http://127.0.0.1 (localhost variant)", () => {
    expect(() => createWebChannel({ authOrigin: "http://127.0.0.1:3000" })).not.toThrow();
  });
});
