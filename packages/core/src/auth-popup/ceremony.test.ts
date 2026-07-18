import { describe, it, expect, vi } from "vitest";
import {
  runAuthPopup,
  type AuthPopupView,
  type AuthPopupCeremonyDeps,
  type AuthPopupAccount,
} from "./ceremony.js";
import type { SignConsentRequest } from "./sign/consent.js";

// A fake opener + window. `emit` delivers a message as if from the opener (event.source === opener).
function harness() {
  const posted: Array<{ data: unknown; origin: string }> = [];
  let closed = false;
  let listener: ((e: MessageEvent) => void) | null = null;
  const opener = { postMessage: (data: unknown, origin: string) => posted.push({ data, origin }) };
  const win = {
    opener,
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
    emit: (data: unknown, origin: string) =>
      listener?.({ data, origin, source: opener } as unknown as MessageEvent),
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
    readAccount: vi.fn().mockResolvedValue(account),
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
    const readAccount = vi.fn().mockResolvedValue(account);
    const view = fakeView();
    runAuthPopup(deps({ win: h.win, readAccount, view }));
    h.emit({ kind: "authorize" }, "https://dapp.example");
    await vi.waitFor(() => expect(readAccount).toHaveBeenCalled());
    expect(view.connecting).toHaveBeenCalled();
    expect(h.posted).toContainEqual({ data: { kind: "authorize", account }, origin: "https://dapp.example" });
  });

  it("sign: shows consent, signs on approve, replies with the result", async () => {
    const h = harness();
    const signWith = vi.fn().mockResolvedValue({ signature: "0xsig" });
    const view = fakeView({ showConsent: vi.fn().mockResolvedValue(true) });
    runAuthPopup(deps({ win: h.win, signWith, view }));
    h.emit({ kind: "sign", request, credentialId: "cred-1" }, "https://dapp.example");
    await vi.waitFor(() =>
      expect(h.posted).toContainEqual({ data: { kind: "sign", result: { signature: "0xsig" } }, origin: "https://dapp.example" }),
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
      expect(h.posted).toContainEqual({ data: { kind: "sign", result: { error: "user_rejected" } }, origin: "https://dapp.example" }),
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
      expect(h.posted).toContainEqual({ data: { kind: "sign", result: { error: "user_rejected" } }, origin: "https://dapp.example" }),
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
      expect(h.posted).toContainEqual({ data: { kind: "sign", result: { signature: "0xretry" } }, origin: "https://dapp.example" }),
    );
    expect(signWith).toHaveBeenCalledTimes(2);
    expect(errorsSeen).toEqual([undefined, "passkey dismissed"]); // second showConsent carried the error
  });

  it("ignores a duplicate request (idempotent) once one is pending", async () => {
    const h = harness();
    const readAccount = vi.fn().mockResolvedValue(account);
    runAuthPopup(deps({ win: h.win, readAccount }));
    h.emit({ kind: "authorize" }, "https://dapp.example");
    h.emit({ kind: "authorize" }, "https://dapp.example"); // duplicate (eager + on ready)
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
    h.emit({ kind: "authorize" }, "https://dapp.example");
    h.emit({ kind: "authorize" }, "https://evil.example");
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
