/**
 * The postMessage pairing transport.
 *
 * Its whole claim is that a browser-authenticated channel can carry the enrolment ceremony without a
 * camera. That claim rests on three rejections — wrong window, wrong origin, wrong shape — so those
 * are tested as behaviour, not assumed from the code reading correctly.
 *
 * MUTATION: delete any one of the three guards in `handler` (`event.source !== peer`,
 * `event.origin !== peerOrigin`, `!isEnvelope(...)`) and the matching rejection test below must fail.
 * Verified when written: each guard, removed individually, fails exactly its own test and no other.
 */
import { describe, it, expect } from "vitest";
import { createWindowPairingTransport } from "../../src/helpers/pairing-window.js";

const PEER_ORIGIN = "https://wallet.example.com";

/** A fake window pair. `deliver` is how a test plays the role of the browser delivering an event. */
function harness(peerOrigin = PEER_ORIGIN) {
  const listeners = new Set<(e: MessageEvent) => void>();
  const sent: unknown[] = [];

  const peer = { postMessage: (msg: unknown) => sent.push(msg) } as unknown as Window;
  const self = {
    addEventListener: (_t: string, fn: EventListener) => listeners.add(fn as (e: MessageEvent) => void),
    removeEventListener: (_t: string, fn: EventListener) => listeners.delete(fn as (e: MessageEvent) => void),
  } as unknown as Window;

  const transport = createWindowPairingTransport({ peer, peerOrigin, self });

  /** Simulate the browser delivering a message. Defaults are the HAPPY path; tests override one. */
  const deliver = (data: unknown, over: { source?: unknown; origin?: string } = {}) => {
    const event = {
      data,
      source: "source" in over ? over.source : peer,
      origin: over.origin ?? new URL(peerOrigin).origin,
    } as unknown as MessageEvent;
    for (const fn of listeners) fn(event);
  };

  const ready = () => deliver({ __avok: "avok-pairing/v1", kind: "ready" });
  const code = (c: string) => deliver({ __avok: "avok-pairing/v1", kind: "code", code: c });

  return { transport, sent, deliver, ready, code, listenerCount: () => listeners.size };
}

describe("window pairing transport — the security checks", () => {
  it("IGNORES a message from a different window at the correct origin", async () => {
    // A sibling tab or nested iframe on the peer origin passes an origin check. It must still be
    // rejected: the ceremony is with one specific window, not with an origin at large.
    const h = harness();
    h.ready();
    const scan = h.transport.scanCode();

    h.deliver({ __avok: "avok-pairing/v1", kind: "code", code: "ATTACKER" }, { source: { other: true } });

    await expect(Promise.race([scan, Promise.resolve("still-pending")])).resolves.toBe("still-pending");
  });

  it("IGNORES a message from a different origin in the correct window", async () => {
    const h = harness();
    h.ready();
    const scan = h.transport.scanCode();

    h.deliver({ __avok: "avok-pairing/v1", kind: "code", code: "ATTACKER" }, { origin: "https://evil.example.com" });

    await expect(Promise.race([scan, Promise.resolve("still-pending")])).resolves.toBe("still-pending");
  });

  it("IGNORES a correctly-sourced message with a foreign or malformed shape", async () => {
    // The peer window is a whole application and may use postMessage for its own traffic. Anything
    // not carrying this transport's envelope must pass straight through untouched.
    const h = harness();
    h.ready();
    const scan = h.transport.scanCode();

    h.deliver({ kind: "code", code: "NO-ENVELOPE" });
    h.deliver({ __avok: "some-other-protocol", kind: "code", code: "WRONG-NS" });
    h.deliver({ __avok: "avok-pairing/v1", kind: "code" }); // code missing
    h.deliver(null);
    h.deliver("a string");

    await expect(Promise.race([scan, Promise.resolve("still-pending")])).resolves.toBe("still-pending");
  });

  it("normalises the expected origin, so a URL with a path still matches", async () => {
    // new URL().origin drops the path. A bare string compare against "https://x.com/pair" would
    // reject every legitimate message.
    const h = harness("https://wallet.example.com/pair");
    h.ready();
    const scan = h.transport.scanCode();
    h.code("OK");
    await expect(scan).resolves.toBe("OK");
  });
});

describe("window pairing transport — the ready handshake", () => {
  it("announces itself on construction", () => {
    const h = harness();
    expect(h.sent[0]).toEqual({ __avok: "avok-pairing/v1", kind: "ready" });
  });

  it("HOLDS a code until the peer announces, then flushes it", () => {
    // postMessage into an about:blank popup is discarded, not queued — the signing channel already
    // paid for this lesson. A code shown before the peer is listening must not be sent into the void.
    const h = harness();
    h.transport.showCode("EARLY");
    expect(h.sent.filter((m) => (m as { kind: string }).kind === "code")).toHaveLength(0);

    h.ready();
    expect(h.sent).toContainEqual({ __avok: "avok-pairing/v1", kind: "code", code: "EARLY" });
  });

  it("answers a peer's announcement so the handshake completes from either side", () => {
    const h = harness();
    h.ready();
    // Two readys sent: one on construction, one in reply. Whichever side attached second still hears.
    expect(h.sent.filter((m) => (m as { kind: string }).kind === "ready")).toHaveLength(2);
  });
});

describe("window pairing transport — code delivery", () => {
  it("BUFFERS a code that arrives before scanCode is called", async () => {
    // The ceremony scans at a specific step; the peer sends when it is ready. Without the buffer a
    // code arriving one tick early is lost and the ceremony hangs forever.
    const h = harness();
    h.ready();
    h.code("EARLY-ARRIVAL");

    await expect(h.transport.scanCode()).resolves.toBe("EARLY-ARRIVAL");
  });

  it("delivers buffered codes in order", async () => {
    const h = harness();
    h.ready();
    h.code("FIRST");
    h.code("SECOND");

    await expect(h.transport.scanCode()).resolves.toBe("FIRST");
    await expect(h.transport.scanCode()).resolves.toBe("SECOND");
  });

  it("refuses a second concurrent scan rather than orphaning the first", async () => {
    const h = harness();
    h.ready();
    const first = h.transport.scanCode();

    await expect(h.transport.scanCode()).rejects.toThrow(/already pending/);

    h.code("FOR-FIRST");
    await expect(first).resolves.toBe("FOR-FIRST");
  });
});

describe("window pairing transport — stop()", () => {
  it("REJECTS a pending scan rather than leaving it unsettled", async () => {
    // An abandoned ceremony that leaves the promise hanging pins the caller's UI in a loading state
    // with nothing left to resolve it.
    const h = harness();
    h.ready();
    const scan = h.transport.scanCode();

    h.transport.stop();

    await expect(scan).rejects.toThrow(/stopped/);
  });

  it("detaches the listener and ignores later traffic", async () => {
    const h = harness();
    h.ready();
    h.transport.stop();

    expect(h.listenerCount()).toBe(0);
    await expect(h.transport.scanCode()).rejects.toThrow(/stopped/);
  });

  it("is idempotent", () => {
    const h = harness();
    h.transport.stop();
    expect(() => h.transport.stop()).not.toThrow();
    expect(() => h.transport.dispose()).not.toThrow();
  });

  it("sends nothing after stop", () => {
    const h = harness();
    h.ready();
    const before = h.sent.length;
    h.transport.stop();
    h.transport.showCode("TOO-LATE");
    expect(h.sent).toHaveLength(before);
  });
});

describe("window pairing transport — end to end with a real peer", () => {
  it("carries codes both ways between two transports", async () => {
    // Two transports wired to each other exactly as an opener and its popup are. This is the actual
    // claim under test: the ceremony's showCode/scanCode contract is satisfiable over postMessage
    // alone, with each side verifying the other's origin.
    const A_ORIGIN = "https://app.example.com";
    const B_ORIGIN = "https://wallet.example.com";

    const aListeners = new Set<(e: MessageEvent) => void>();
    const bListeners = new Set<(e: MessageEvent) => void>();
    const windowA = {} as Window;
    const windowB = {} as Window;

    // Posting INTO a window delivers to that window's listeners, stamped with the SENDER's window
    // and origin — which is what the browser does, and what the guards check.
    Object.assign(windowB, {
      postMessage: (msg: unknown) => {
        for (const fn of bListeners) fn({ data: msg, source: windowA, origin: A_ORIGIN } as unknown as MessageEvent);
      },
    });
    Object.assign(windowA, {
      postMessage: (msg: unknown) => {
        for (const fn of aListeners) fn({ data: msg, source: windowB, origin: B_ORIGIN } as unknown as MessageEvent);
      },
    });

    const mkSelf = (set: Set<(e: MessageEvent) => void>) =>
      ({
        addEventListener: (_t: string, fn: EventListener) => set.add(fn as (e: MessageEvent) => void),
        removeEventListener: (_t: string, fn: EventListener) => set.delete(fn as (e: MessageEvent) => void),
      }) as unknown as Window;

    const appSide = createWindowPairingTransport({ peer: windowB, peerOrigin: B_ORIGIN, self: mkSelf(aListeners) });
    const walletSide = createWindowPairingTransport({ peer: windowA, peerOrigin: A_ORIGIN, self: mkSelf(bListeners) });

    appSide.showCode("REQUEST");
    await expect(walletSide.scanCode()).resolves.toBe("REQUEST");

    walletSide.showCode("ACK");
    await expect(appSide.scanCode()).resolves.toBe("ACK");

    appSide.showCode("WRAP");
    await expect(walletSide.scanCode()).resolves.toBe("WRAP");

    appSide.stop();
    walletSide.stop();
  });
});
