/**
 * A `PairingTransport` over `postMessage`, for enrolment between two ORIGINS ON ONE DEVICE.
 *
 * The QR transport (`@avokjs/core/qr`) exists to move codes between two DEVICES, where the only shared
 * channel is a camera pointed at a screen. Applied to two origins on the same device it produces the
 * worst interaction in the product: the user is asked to scan a QR code displayed on the screen they
 * are already looking at. This is the same ceremony, byte for byte, over a channel that actually fits.
 *
 * WHY THIS IS NOT A WEAKER CHANNEL. A camera link is anonymous — nothing about a scanned image says
 * which program drew it, which is precisely why the ceremony compares a SAS. A `postMessage` link is
 * the opposite: the browser stamps every message with its sender's origin and will not let a page lie
 * about it. So this transport can verify its peer is exactly the origin the ceremony intends, before
 * a single byte of the ceremony is read. That is the SAME trust boundary the shared-origin signing
 * channel already stands on ("the ONLY origin whose replies are trusted", channel/channels/web.ts).
 *
 * THE CEREMONY IS UNCHANGED. Same three codes, same SAS, same crypto — only the pipe differs. Whether
 * an authenticated channel makes the SAS redundant is a real question and deliberately NOT answered
 * here: dropping it is a change to the security argument, and it does not belong in a commit that
 * changes the transport. Users of this transport still confirm digits today.
 *
 * SECURITY CHECKS, all three required, mirroring the signing channel:
 *   1. `event.source === peer`  — the exact window, not merely something at the right origin. A
 *      sibling tab or a nested iframe on the peer origin passes an origin check and fails this one.
 *   2. `event.origin === peerOrigin` — normalised via `new URL().origin`, so a trailing path or
 *      port-less form cannot smuggle a near-miss past a string compare.
 *   3. Shape validation before use — a message with a missing or garbage kind is ignored, never
 *      coerced.
 */
import type { PairingTransport } from "./pairing.js";

/** Wire envelope. Namespaced because the peer window is a full application that may use postMessage
 *  for its own purposes, and a bare `{ kind }` would collide with the signing channel's messages. */
const ENVELOPE = "avok-pairing/v1" as const;

type Envelope = { __avok: typeof ENVELOPE; kind: "ready" } | { __avok: typeof ENVELOPE; kind: "code"; code: string };

function isEnvelope(data: unknown): data is Envelope {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d["__avok"] !== ENVELOPE) return false;
  return d["kind"] === "ready" || (d["kind"] === "code" && typeof d["code"] === "string");
}

export interface WindowPairingTransport extends PairingTransport {
  /** Detach the listener. `stop()` already does this; exposed for symmetry with other transports. */
  dispose(): void;
}

/**
 * Build a transport that exchanges pairing codes with `peer` over `postMessage`.
 *
 * Both sides construct one. The opener passes the popup it opened; the popup passes `window.opener`.
 * Each side names the origin it expects the OTHER to be.
 *
 * @param opts.peer       The peer window (a popup, or `window.opener`).
 * @param opts.peerOrigin The origin that window must be. Anything else is ignored, silently — a
 *                        rejected message is an attack or a bug, and answering it would confirm the
 *                        listener exists.
 * @param opts.self       Window to listen on. Defaults to `globalThis`; injectable for tests.
 */
export function createWindowPairingTransport(opts: {
  peer: Window;
  peerOrigin: string;
  self?: Window;
}): WindowPairingTransport {
  const { peer } = opts;
  // Normalise once. "https://a.example.com/path" and "https://a.example.com" must compare equal, and
  // a bare string compare would say they do not.
  const peerOrigin = new URL(opts.peerOrigin).origin;
  const listenOn = (opts.self ?? (globalThis as unknown as Window)) as Window;

  let stopped = false;
  let peerReady = false;
  /** Codes that arrived before anyone asked for one. The ceremony calls `scanCode()` at a specific
   *  step, but the peer sends when IT is ready — without this buffer, a code that arrives one tick
   *  early is dropped and the ceremony hangs forever. */
  const inbox: string[] = [];
  /** Codes we were asked to show before the peer announced itself (see the ready handshake below). */
  const outbox: string[] = [];
  let waiting: { resolve: (code: string) => void; reject: (e: Error) => void } | null = null;

  function post(msg: Envelope): void {
    peer.postMessage(msg, peerOrigin);
  }

  function handler(event: MessageEvent): void {
    if (stopped) return;
    if (event.source !== peer) return;
    if (event.origin !== peerOrigin) return;
    if (!isEnvelope(event.data)) return;

    // READY HANDSHAKE. A popup opened moments ago is still an empty about:blank document, and
    // postMessage to a document that has not loaded is DISCARDED, not queued — the signing channel
    // learned this the hard way (channel/channels/web.ts). So neither side sends a code until the
    // peer has announced its listener is attached. Announcing back makes it symmetric: whichever
    // side attaches second still hears from the first.
    if (event.data.kind === "ready") {
      if (!peerReady) {
        peerReady = true;
        post({ __avok: ENVELOPE, kind: "ready" });
        for (const code of outbox.splice(0)) post({ __avok: ENVELOPE, kind: "code", code });
      }
      return;
    }

    const { code } = event.data;
    if (waiting) {
      const w = waiting;
      waiting = null;
      w.resolve(code);
    } else {
      inbox.push(code);
    }
  }

  listenOn.addEventListener("message", handler as EventListener);
  // Announce immediately. If the peer is not listening yet its own announcement will reach us later,
  // and the handshake completes from whichever end attached first.
  post({ __avok: ENVELOPE, kind: "ready" });

  return {
    showCode(code: string): void {
      if (stopped) return;
      if (peerReady) post({ __avok: ENVELOPE, kind: "code", code });
      else outbox.push(code);
    },

    scanCode(): Promise<string> {
      if (stopped) return Promise.reject(new Error("pairing transport stopped"));
      const buffered = inbox.shift();
      if (buffered !== undefined) return Promise.resolve(buffered);
      // Only one scan is ever outstanding — the ceremony is strictly sequential. A second concurrent
      // call would silently orphan the first, so refuse rather than lose it.
      if (waiting) return Promise.reject(new Error("a scan is already pending"));
      return new Promise<string>((resolve, reject) => {
        waiting = { resolve, reject };
      });
    },

    stop(): void {
      if (stopped) return;
      stopped = true;
      listenOn.removeEventListener("message", handler as EventListener);
      inbox.length = 0;
      outbox.length = 0;
      // A pending scan must REJECT, not hang. An abandoned ceremony that leaves a promise unsettled
      // keeps the caller's UI in a loading state with nothing left to resolve it.
      if (waiting) {
        const w = waiting;
        waiting = null;
        w.reject(new Error("pairing transport stopped"));
      }
    },

    dispose(): void {
      this.stop();
    },
  };
}
