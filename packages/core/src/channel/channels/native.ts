/**
 * Native in-app browser signing channel — the shared-origin rail for React Native.
 *
 * SHARED-ORIGIN EXISTS FOR APPS THAT DO NOT OWN THE WALLET'S DOMAIN. A passkey is scoped to an rpId,
 * and an app can only use one whose domain claims it back via /.well-known files it cannot host. The
 * answer on the web is a popup: run the ceremony in a context that genuinely IS the wallet's origin,
 * and let only the result come back. That answer is not web-specific — it needs a browsing context
 * that owns the origin, and a native in-app browser tab is exactly that.
 *
 * MEASURED ON DEVICE (2026-07-20): a WebAuthn ceremony with the PRF extension — the whole basis of
 * K = HKDF(PRF(credential, rpId)) — succeeds inside BOTH iOS ASWebAuthenticationSession and Android
 * Chrome Custom Tabs. That was the make-or-break question and it passes on both. RFC 8252 §6 endorses
 * this shape and names both APIs; §8.12 forbids the embedded WebView alternative.
 *
 * WHAT DIFFERS FROM THE POPUP, and it is not cosmetic:
 *
 *   - ONE SHOT. There is no postMessage. The app opens a URL and the session ends by redirecting to a
 *     registered callback. So it is one session per signature — which is what the web channel already
 *     does anyway (it opens and closes a popup per request), so the semantics match.
 *   - NO ORIGIN AUTHENTICITY. postMessage tells you who replied; a callback URL does not. Anything
 *     able to steer the session can redirect to it. The result is therefore never trusted on arrival:
 *     `authorize` carries a signature over the caller's nonce, verified by the connection
 *     (channel/authorize-proof.ts). This channel PARSES; it does not authenticate.
 *   - URL-BOUND SIZE. See redirect-protocol.ts — bounded conservatively and refused loudly, because
 *     an oversized URL is silently truncated on Chromium and looks exactly like a cancellation.
 *
 * The browser session is INJECTED rather than imported. Core stays platform-neutral, the RN facade
 * supplies expo-web-browser, and a test supplies a function — the same seam the passkey adapter uses.
 */
import type { SigningChannel, ChannelRequest, ChannelResult } from "./port.js";
import { encodeRequestUrl, decodeResultUrl } from "../redirect-protocol.js";

/**
 * What the platform must provide: open `url`, return the callback URL the session ended on, or null
 * if the user dismissed it.
 *
 * This is exactly the shape of `expo-web-browser`'s `openAuthSessionAsync`, deliberately — the common
 * case should be a one-line adapter rather than a translation layer.
 */
export type AuthSessionOpener = (url: string, redirectUri: string) => Promise<{ type: string; url?: string }>;

export class AuthSessionCancelledError extends Error {
  constructor() {
    super("The signing session was dismissed before it completed");
    this.name = "AuthSessionCancelledError";
  }
}

export function createNativeChannel(opts: {
  /** The operator's auth origin — the page to open, and the wallet that holds the keys. */
  authOrigin: string;
  /** Where the session redirects when it finishes, e.g. `myapp://avok-callback`. */
  redirectUri: string;
  /** Platform binding. RN supplies expo-web-browser's openAuthSessionAsync. */
  openAuthSession: AuthSessionOpener;
}): SigningChannel {
  // Same rule as the web channel: HTTPS or localhost, enforced at construction rather than at the
  // first signature. A wallet reached over plaintext is not a wallet.
  const parsed = new URL(opts.authOrigin);
  if (parsed.protocol !== "https:") {
    const h = parsed.hostname;
    if (h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]") {
      throw new Error(
        `createNativeChannel: authOrigin must use HTTPS (got "${opts.authOrigin}"). ` +
          `HTTP is only allowed for localhost development.`,
      );
    }
  }

  return {
    async open(req: ChannelRequest): Promise<ChannelResult> {
      const url = encodeRequestUrl({
        authOrigin: opts.authOrigin,
        request: req,
        redirectUri: opts.redirectUri,
      });

      const outcome = await opts.openAuthSession(url, opts.redirectUri);

      // A dismissed session is the ORDINARY outcome of a user changing their mind, and it must be
      // distinguishable from a failure — an app that cannot tell them apart shows an error for a
      // deliberate cancel.
      if (outcome.type !== "success" || !outcome.url) throw new AuthSessionCancelledError();

      const result = decodeResultUrl(outcome.url);
      if (!result) {
        throw new Error("The signing session returned no result — the callback URL carried no payload");
      }
      // Shape check only. Whether this result is TRUE is settled downstream: an authorize proves
      // control of the address it returns, and a signature is checked against what it claims to sign.
      if (result.kind !== "sign" && result.kind !== "authorize") {
        throw new Error(`The signing session returned an unrecognised result kind`);
      }
      if (result.kind !== req.kind) {
        // A reply of a different kind than was asked for is a confused or hostile session, never a
        // legitimate answer.
        throw new Error(`Expected a "${req.kind}" result, got "${result.kind}"`);
      }
      return result;
    },
  };
}
