import { describe, it, expect, vi } from "vitest";
import { encodeRequestUrl, decodeResultUrl } from "../../src/channel/redirect-protocol.js";
import {
  runAuthPopup,
  runAuthRedirect,
  type AuthPopupView,
  type AuthPopupCeremonyDeps,
  type AuthPopupAccount,
} from "../../src/auth-popup/ceremony.js";
import type { SignConsentRequest } from "../../src/auth-popup/sign/consent.js";

// A fake opener + window. `emit` delivers a message as if from the opener (event.source === opener).
function harness() {
  const posted: Array<{ data: unknown; origin: string }> = [];
  let closed = false;
  let listener: ((e: MessageEvent) => void) | null = null;
  const opener = { postMessage: (data: unknown, origin: string) => posted.push({ data, origin }) };
  const win = {
    opener,
    // The proof is bound to the page's own origin, so a signature obtained at one operator cannot
    // be replayed at another.
    location: { origin: "https://wallet.example" },
    addEventListener: (_t: "message", fn: (e: MessageEvent) => void) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
    close: () => {
      closed = true;
    },
  };
  return {
    win: win as unknown as AuthPopupCeremonyDeps["win"],
    posted,
    get closed() {
      return closed;
    },
    emit: (data: unknown, origin: string) => listener?.({ data, origin, source: opener } as unknown as MessageEvent),
    emitFrom: (source: unknown, data: unknown, origin: string) =>
      listener?.({ data, origin, source } as unknown as MessageEvent),
  };
}

function fakeView(overrides: Partial<AuthPopupView> = {}): AuthPopupView {
  return {
    connecting: vi.fn(),
    showConsent: vi.fn().mockResolvedValue(true),
    waitingForPasskey: vi.fn(),
    failure: vi.fn(),
    ...overrides,
  };
}

const account: AuthPopupAccount = { evmAddress: "0xevm", solanaAddress: "sol", credentialId: "cred-1" };

// A real, decodable request: decodeSignConsent → formatConsentDisplay yields ["Sign message:", "hi"].
const request: SignConsentRequest = { op: "signMessage", message: "hi" };

function deps(over: Partial<AuthPopupCeremonyDeps>): AuthPopupCeremonyDeps {
  return {
    view: fakeView(),
    readAccount: vi.fn().mockResolvedValue({ account, proof: "0xproof" }),
    signWith: vi.fn().mockResolvedValue({ signature: "0xsig" }),
    win: harness().win,
    ...over,
  };
}

describe("runAuthPopup", () => {
  it("posts { kind:'ready' } to the opener with targetOrigin '*' on start", () => {
    const h = harness();
    runAuthPopup(deps({ win: h.win }));
    expect(h.posted[0]).toEqual({ data: { kind: "ready" }, origin: "*" });
  });

  it("authorize: runs the gesture and replies with the account to the pinned origin", async () => {
    const h = harness();
    const readAccount = vi.fn().mockResolvedValue({ account, proof: "0xproof" });
    const view = fakeView();
    runAuthPopup(deps({ win: h.win, readAccount, view }));
    h.emit({ kind: "authorize", nonce: "abc123" }, "https://dapp.example");
    await vi.waitFor(() => expect(readAccount).toHaveBeenCalled());
    expect(view.connecting).toHaveBeenCalled();
    // The gesture signs the CHALLENGE, not the bare nonce — bound to this page's origin and tagged
    // with its purpose, so the signature cannot be reused as any other kind of signature.
    expect(readAccount).toHaveBeenCalledWith(expect.stringContaining("nonce: abc123"));
    expect(readAccount).toHaveBeenCalledWith(expect.stringContaining("origin: https://wallet.example"));
    expect(h.posted).toContainEqual({
      data: { kind: "authorize", account, proof: "0xproof" },
      origin: "https://dapp.example",
    });
  });

  it("sign: shows consent, signs on approve, replies with the result", async () => {
    const h = harness();
    const signWith = vi.fn().mockResolvedValue({ signature: "0xsig" });
    const view = fakeView({ showConsent: vi.fn().mockResolvedValue(true) });
    runAuthPopup(deps({ win: h.win, signWith, view }));
    h.emit({ kind: "sign", request, credentialId: "cred-1" }, "https://dapp.example");
    await vi.waitFor(() =>
      expect(h.posted).toContainEqual({
        data: { kind: "sign", result: { signature: "0xsig" } },
        origin: "https://dapp.example",
      }),
    );
    expect(view.waitingForPasskey).toHaveBeenCalled();
    expect(signWith).toHaveBeenCalledWith(request, "cred-1");
    expect(h.closed).toBe(true);
  });

  it("sign: reject replies user_rejected and never signs", async () => {
    const h = harness();
    const signWith = vi.fn();
    const view = fakeView({ showConsent: vi.fn().mockResolvedValue(false) });
    runAuthPopup(deps({ win: h.win, signWith, view }));
    h.emit({ kind: "sign", request }, "https://dapp.example");
    await vi.waitFor(() =>
      expect(h.posted).toContainEqual({
        data: { kind: "sign", result: { error: "user_rejected" } },
        origin: "https://dapp.example",
      }),
    );
    expect(signWith).not.toHaveBeenCalled();
  });

  it("sign: a request that cannot be decoded is reject-only (Approve never reachable)", async () => {
    const h = harness();
    const signWith = vi.fn();
    // showConsent records the opts it was called with; rejectOnly must be true, and it resolves false.
    const seen: Array<{ error?: string; rejectOnly?: boolean } | undefined> = [];
    const view = fakeView({
      showConsent: vi.fn().mockImplementation((_lines: string[], opts) => {
        seen.push(opts);
        return Promise.resolve(false);
      }),
    });
    // An undecodable request: pass a shape decodeSignConsent throws on.
    runAuthPopup(deps({ win: h.win, signWith, view }));
    h.emit({ kind: "sign", request: { not: "a real request" } }, "https://dapp.example");
    await vi.waitFor(() =>
      expect(h.posted).toContainEqual({
        data: { kind: "sign", result: { error: "user_rejected" } },
        origin: "https://dapp.example",
      }),
    );
    expect(signWith).not.toHaveBeenCalled();
    expect(seen[0]?.rejectOnly).toBe(true);
  });

  it("sign: a failed gesture re-shows consent with the error, then can succeed on retry", async () => {
    const h = harness();
    const signWith = vi
      .fn()
      .mockRejectedValueOnce(new Error("passkey dismissed"))
      .mockResolvedValueOnce({ signature: "0xretry" });
    const errorsSeen: Array<string | undefined> = [];
    const view = fakeView({
      showConsent: vi.fn().mockImplementation((_lines: string[], opts?: { error?: string }) => {
        errorsSeen.push(opts?.error);
        return Promise.resolve(true); // approve every time
      }),
    });
    runAuthPopup(deps({ win: h.win, signWith, view }));
    h.emit({ kind: "sign", request }, "https://dapp.example");
    await vi.waitFor(() =>
      expect(h.posted).toContainEqual({
        data: { kind: "sign", result: { signature: "0xretry" } },
        origin: "https://dapp.example",
      }),
    );
    expect(signWith).toHaveBeenCalledTimes(2);
    expect(errorsSeen).toEqual([undefined, "passkey dismissed"]); // second showConsent carried the error
  });

  it("ignores a duplicate request (idempotent) once one is pending", async () => {
    const h = harness();
    const readAccount = vi.fn().mockResolvedValue(account);
    runAuthPopup(deps({ win: h.win, readAccount }));
    h.emit({ kind: "authorize", nonce: "abc123" }, "https://dapp.example");
    h.emit({ kind: "authorize", nonce: "abc123" }, "https://dapp.example"); // duplicate (eager + on ready)
    await vi.waitFor(() => expect(readAccount).toHaveBeenCalled());
    expect(readAccount).toHaveBeenCalledTimes(1);
  });

  it("rejects messages from anything other than the opener", async () => {
    const h = harness();
    const readAccount = vi.fn().mockResolvedValue(account);
    runAuthPopup(deps({ win: h.win, readAccount }));
    h.emitFrom({}, { kind: "authorize" }, "https://dapp.example"); // source !== opener
    await Promise.resolve();
    expect(readAccount).not.toHaveBeenCalled();
  });

  it("pins the opener origin and drops a later origin switch", async () => {
    const h = harness();
    const readAccount = vi.fn().mockResolvedValue(account);
    runAuthPopup(deps({ win: h.win, readAccount }));
    // First message pins dapp.example; a second from evil.example must be dropped (and it also would
    // be dropped by idempotency, so send the switch FIRST as a non-authorize kind to pin, then retry).
    h.emit({ kind: "authorize", nonce: "abc123" }, "https://dapp.example");
    h.emit({ kind: "authorize", nonce: "abc123" }, "https://evil.example");
    await vi.waitFor(() => expect(readAccount).toHaveBeenCalled());
    // Only the pinned-origin reply exists.
    expect(h.posted.filter((p) => p.origin === "https://evil.example")).toHaveLength(0);
  });

  it("ignores empty / opaque ('null') origins", async () => {
    const h = harness();
    const readAccount = vi.fn().mockResolvedValue(account);
    runAuthPopup(deps({ win: h.win, readAccount }));
    h.emit({ kind: "authorize" }, "null");
    h.emit({ kind: "authorize" }, "");
    await Promise.resolve();
    expect(readAccount).not.toHaveBeenCalled();
  });
});

/**
 * The redirect-driven entry point — the SAME ceremony, reached by URL instead of by message.
 *
 * A native in-app browser session has no opener to postMessage to. It gets its request in the page's
 * fragment and answers by navigating to the app's callback. What must NOT differ is anything between
 * those points: the consent screen, the gesture, the authorize proof and the retry loop all live in
 * one shared path, because a wallet that behaves differently depending on how it was opened is a
 * wallet with two security surfaces and one test suite.
 *
 * MUTATION: point runAuthRedirect at its own copy of the ceremony and these still pass — which is why
 * the shared path is asserted by BEHAVIOUR here (same proof, same challenge binding) rather than by
 * reading the code.
 */
describe("runAuthRedirect (native session)", () => {
  const REDIRECT = "myapp://avok-callback";

  function redirectHarness(request: unknown) {
    const navigated: string[] = [];
    const win = {
      opener: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      location: {
        origin: "https://wallet.example",
        href: encodeRequestUrl({
          authOrigin: "https://wallet.example",
          request: request as never,
          redirectUri: REDIRECT,
        }),
        assign: (url: string) => navigated.push(url),
      },
    };
    return { win, navigated };
  }

  it("reads the request from the fragment and answers by NAVIGATING to the callback", async () => {
    const h = redirectHarness({ kind: "authorize", nonce: "abc123" });
    const readAccount = vi.fn().mockResolvedValue({ account, proof: "0xproof" });
    runAuthRedirect(deps({ win: h.win as never, readAccount, view: fakeView() }) as never);

    await vi.waitFor(() => expect(h.navigated).toHaveLength(1));
    const result = decodeResultUrl(h.navigated[0]!);
    expect(result).toEqual({ kind: "authorize", account, proof: "0xproof" });
  });

  it("signs the SAME challenge the popup flow does — one ceremony, not two", async () => {
    // If the redirect path grew its own challenge construction, a wallet reached natively would sign
    // something the verifier does not expect, and shared-origin would silently work on one transport
    // and fail on the other.
    const h = redirectHarness({ kind: "authorize", nonce: "abc123" });
    const readAccount = vi.fn().mockResolvedValue({ account, proof: "0xproof" });
    runAuthRedirect(deps({ win: h.win as never, readAccount, view: fakeView() }) as never);

    await vi.waitFor(() => expect(readAccount).toHaveBeenCalled());
    expect(readAccount).toHaveBeenCalledWith(expect.stringContaining("nonce: abc123"));
    expect(readAccount).toHaveBeenCalledWith(expect.stringContaining("origin: https://wallet.example"));
  });

  it("REFUSES an authorize with no challenge, exactly as the popup flow does", async () => {
    const h = redirectHarness({ kind: "authorize" });
    const view = fakeView();
    runAuthRedirect(deps({ win: h.win as never, view }) as never);

    await vi.waitFor(() => expect(view.failure).toHaveBeenCalled());
    expect(h.navigated).toHaveLength(0); // nothing was answered
  });

  it("says so plainly when the page was opened with no request at all", async () => {
    // Bookmarked, refreshed, or reached by something that is not the SDK. There is nothing to sign
    // and nobody to answer; guessing would be worse than saying so.
    const view = fakeView();
    const win = {
      opener: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { origin: "https://wallet.example", href: "https://wallet.example/", assign: () => {} },
    };
    runAuthRedirect(deps({ win: win as never, view }) as never);
    expect(view.failure).toHaveBeenCalledWith(expect.stringMatching(/without a signing request/i));
  });
});
