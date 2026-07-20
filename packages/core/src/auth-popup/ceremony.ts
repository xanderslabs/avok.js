/**
 * The framework-free auth-popup ceremony driver.
 *
 * This is the wallet-sandbox popup's brain, with the DOM and React removed. It owns the postMessage
 * protocol and the authorize/sign orchestration that used to live inline in the two React app entries
 * (app/src/authorize.tsx + sign.tsx). Rendering is behind the `AuthPopupView` seam, so both the
 * plain-DOM `mountAuthPopup` (which the emitter inlines) and the React `<AuthPopup>` drive the SAME
 * protocol, and this file is fully unit-testable with a fake view + fake window.
 *
 * ONE PAGE, TWO REQUESTS. The popup posts `ready`, then services whatever the opener asks from the
 * same passkey/sandbox setup:
 *   { kind:"authorize" } → ONE gesture reads the wallet → reply { kind:"authorize", account }. No consent.
 *   { kind:"sign", request, credentialId? } → decode IN-BUNDLE (no gesture) → show consent →
 *     Approve: ONE gesture, sign IN THE BROWSER → reply { kind:"sign", result };
 *     Reject / undecodable: reply { kind:"sign", result:{ error:"user_rejected" } }.
 *
 * The wallet key never leaves: the gesture (readAccount / signWith) reconstructs K from the passkey PRF
 * here, uses it, and discards it. Only the account (public) or the signature crosses back.
 *
 * DEVICE-GATED: the real gesture + cross-origin postMessage need a live browser. The gesture is
 * injected (readAccount / signWith) so the protocol logic here is pure.
 */
import type { Hex } from "viem";
import { authorizeChallenge } from "../channel/authorize-proof.js";
import type { ChannelResult } from "../channel/channels/port.js";
import { decodeRequestUrl, encodeResultUrl } from "../channel/redirect-protocol.js";
import { decodeSignConsent, type SignConsentRequest } from "./sign/consent.js";
import { formatConsentDisplay } from "./sign/consent-display.js";

/** The operator config baked into the page, mirrors app/branding.ts's AppConfig. */
export interface AuthPopupConfig {
  operatorName: string;
  authOrigin: string;
  /** The operator's PINNED rpId. Used verbatim by the gesture — NEVER inferred from the URL. An
   *  origin on a subdomain (auth.example.com) has a hostname that is not the rpId (example.com);
   *  inferring finds no passkey, and since K = HKDF(PRF(credential, rpId)) it derives a DIFFERENT
   *  WALLET. */
  rpId: string;
  defaultChainId: number;
  managementUrl?: string;
  paymasterUrl?: string;
  feeToken?: string;
}

/** The account the authorize flow hands back to the opener. `credentialId` lets later sign popups
 *  constrain the assertion to the right passkey (straight to biometrics, no picker). */
export interface AuthPopupAccount {
  evmAddress: string;
  solanaAddress?: string;
  credentialId?: string;
}

/**
 * Everything user-visible, behind one seam. The driver never touches the DOM; a renderer implements
 * this. `showConsent` resolves true=approve / false=reject and is the ONLY gate to signing.
 */
export interface AuthPopupView {
  /** Authorize flow is running (a "Signing you in…" state). */
  connecting(): void;
  /**
   * Show the decoded request and wait for the user's decision. Resolves true to approve, false to
   * reject. `rejectOnly` renders a dismiss-only screen (used when decode failed — the request can
   * never be approved, but the user must still be able to dismiss it) and resolves false. `error`
   * surfaces a failed signing attempt so the user can retry Approve.
   */
  showConsent(lines: string[], opts?: { error?: string; rejectOnly?: boolean }): Promise<boolean>;
  /** The passkey gesture is pending. */
  waitingForPasskey(): void;
  /** A terminal error with no reply path (the authorize gesture failed). */
  failure(message: string): void;
}

interface OpenerLike {
  postMessage(data: unknown, targetOrigin: string): void;
}
interface WindowLike {
  opener: OpenerLike | null;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  /** Optional: closed after a sign reply (mirrors the old sign.tsx). Tests omit it. */
  close?(): void;
  /** This page's own origin — the authorize proof is bound to it, so a signature obtained here
   *  cannot be replayed against a different operator. */
  location: { origin: string };
}

export interface AuthPopupCeremonyDeps {
  view: AuthPopupView;
  /** ONE gesture: reconstruct the wallet from the passkey PRF and return the (public) account. */
  /** ONE gesture: reconstruct the wallet, return the (public) account AND a signature over the
   *  caller's challenge. The signature is what makes the returned address verifiable — see
   *  channel/authorize-proof.ts for why trusting the transport is not enough. */
  readAccount(challenge: string): Promise<{ account: AuthPopupAccount; proof: Hex }>;
  /** ONE gesture: reconstruct the wallet, sign the request, discard the key. Returns performSign's
   *  result. `credentialId` (from the sign message) constrains the assertion, with a fallback to an
   *  unconstrained discover() handled inside the implementation. */
  signWith(request: SignConsentRequest, credentialId?: string): Promise<unknown>;
  win: WindowLike;
}

type SignMessage = { kind: "sign"; request: unknown; credentialId?: string };

/** How a result gets home. postMessage on the web popup, a redirect in a native browser session —
 *  the ceremony itself is identical either way, and that is the point of the seam. */
type Reply = (result: ChannelResult) => void;

/**
 * Attach the message listener and post `ready`. Returns a disposer that removes the listener.
 *
 * Only our direct opener is trusted, and only the origin it FIRST spoke from — learned here, from the
 * browser, and never re-derived from anything the page could influence. The opener posts its request
 * eagerly (in the same task as window.open, before this document exists — postMessage does not queue
 * for an unloaded document) AND again on our `ready`, so a duplicate can arrive: we take the first and
 * ignore the rest (`pending`).
 */

/** WindowLike, plus what a redirect-driven page needs: its own URL, and the ability to leave. */
export interface RedirectWindow {
  location: { origin: string; href: string; assign(url: string): void };
}

/**
 * The ceremony itself, independent of how the request arrived or how the answer leaves.
 *
 * Both transports funnel here so there is exactly ONE implementation of the consent screen, the
 * passkey gesture, the authorize proof and the retry loop. A second copy would be a second place for
 * a blind-signing bug to live, and the tests would only ever cover one of them.
 */
function driveRequest(deps: AuthPopupCeremonyDeps, data: Record<string, unknown>, reply: Reply): void {
  const { view, win } = deps;
  const kind = data["kind"];

  async function runSign(msg: SignMessage): Promise<void> {
    // Decode IN THIS BUNDLE (it was always a stateless pure function; the old token-gated endpoint is
    // gone). NEVER enable Approve unless the request actually decoded and displayed — a failed decode
    // stays terminal (reject-only), because blind signing is exactly what a consent screen prevents.
    let lines: string[];
    let rejectOnly = false;
    try {
      lines = formatConsentDisplay(decodeSignConsent(msg.request as SignConsentRequest));
      if (!Array.isArray(lines) || lines.length === 0) {
        throw new Error("No summary could be produced for this request.");
      }
    } catch (err) {
      lines = ["Can't show you this request, so it can't be approved.", (err as Error).message];
      rejectOnly = true;
    }

    let error: string | undefined;
    for (;;) {
      const approved = await view.showConsent(lines, { error, rejectOnly });
      if (!approved) {
        // The only refusal left is user_rejected — there is no session to expire (#8).
        reply({ kind: "sign", result: { error: "user_rejected" } as never });
        return;
      }
      view.waitingForPasskey();
      try {
        const result = await deps.signWith(msg.request as SignConsentRequest, msg.credentialId);
        reply({ kind: "sign", result: result as never });
        return;
      } catch (err) {
        // Signing failed (e.g. the gesture was dismissed). Re-show the consent with the error so the
        // user can retry Approve or Reject — matching the old sign.tsx, which re-enabled the actions.
        error = (err as Error).message;
      }
    }
  }

  if (kind === "authorize") {
    const nonce = (data as { nonce?: unknown }).nonce;
    // No challenge, no reply. An authorize without a nonce cannot be proved, and answering it
    // anyway would hand back an address the caller has no way to verify — exactly the situation
    // the proof exists to remove.
    if (typeof nonce !== "string" || nonce.length === 0) {
      view.failure("Authorization request carried no challenge nonce");
      return;
    }
    view.connecting();
    // Bound to THIS page's own origin. The wallet signs a challenge naming where it lives, so the
    // signature cannot be replayed against a different operator.
    const challenge = authorizeChallenge({ nonce, authOrigin: win.location.origin });
    deps
      .readAccount(challenge)
      .then(({ account, proof }) => {
        // Reply in the channel's ChannelResult shape. HOW it travels is the transport's business.
        reply({ kind: "authorize", account: account as never, proof });
      })
      .catch((e: Error) => view.failure(e.message));
    return;
  }

  void runSign(data as unknown as SignMessage);
}

export function runAuthPopup(deps: AuthPopupCeremonyDeps): () => void {
  // The ceremony itself lives in driveRequest; this function is only the postMessage transport —
  // origin pinning, duplicate suppression, and how a reply gets home.
  const { win } = deps;
  let pinnedOrigin: string | null = null;
  let pending = false;

  function handler(event: MessageEvent): void {
    if (event.source !== win.opener) return;
    if (!event.origin || event.origin === "null") return;
    // Pin the opener origin on the first accepted message; drop any later origin switch.
    if (pinnedOrigin === null) pinnedOrigin = event.origin;
    else if (event.origin !== pinnedOrigin) return;

    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const kind = (data as { kind?: unknown }).kind;
    if (kind !== "authorize" && kind !== "sign") return;

    if (pending) return;
    pending = true;
    // postMessage replies are TARGETED at the pinned origin, never "*".
    const origin = pinnedOrigin as string;
    const reply: Reply = (result) => {
      win.opener?.postMessage(result, origin);
      if (result.kind === "sign") win.close?.();
    };

    driveRequest(deps, data as Record<string, unknown>, reply);
  }

  win.addEventListener("message", handler);

  // Tell the opener we are listening. Without this the request is LOST (see above). targetOrigin "*"
  // is safe and unavoidable here: the payload is a bare { kind:"ready" } with no secret, and we cannot
  // yet name the opener's origin — we only learn it from its first message. Every message that CARRIES
  // anything (the account, the signature, the rejection) is targeted at the pinned origin, never "*".
  win.opener?.postMessage({ kind: "ready" }, "*");

  return () => win.removeEventListener("message", handler);
}

/**
 * The SAME ceremony, driven by a URL instead of a message — for a native in-app browser session.
 *
 * A session opened by ASWebAuthenticationSession or Chrome Custom Tabs has no opener to postMessage
 * to. It receives its request in the page's fragment and answers by navigating to the app's callback.
 * Everything between those two points — the consent screen, the passkey gesture, the authorize proof,
 * the retry loop on a dismissed signature — is `runAuthPopup`'s logic, reached through the same reply
 * seam. That sharing is deliberate: two copies of a consent ceremony is two places for a blind-signing
 * bug to hide, and only one of them would be the one anybody tested.
 *
 * Returns a disposer for symmetry with runAuthPopup; there is no listener to detach, so it is a no-op.
 */
export function runAuthRedirect(deps: AuthPopupCeremonyDeps & { win: WindowLike & RedirectWindow }): () => void {
  const { win, view } = deps;

  const parsed = decodeRequestUrl(win.location.href);
  if (!parsed) {
    // Reached directly — bookmarked, refreshed, or opened by something that is not the SDK. There is
    // nothing to sign and nobody to answer, and guessing would be worse than saying so.
    view.failure("This page was opened without a signing request");
    return () => {};
  }

  const { request, redirectUri } = parsed;
  // The redirect target is ECHOED from the request, never trusted as authority. It decides only where
  // the answer is delivered; whether that answer is believable is settled by what is inside it — an
  // authorize carries a signature over the caller's nonce, and a signature is checked against what it
  // claims to sign. A hostile redirectUri therefore steers a result that proves nothing.
  const reply: Reply = (result) => {
    win.location.assign(encodeResultUrl({ redirectUri, result }));
  };

  driveRequest(deps, request as unknown as Record<string, unknown>, reply);
  return () => {};
}
