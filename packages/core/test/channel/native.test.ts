/**
 * The native in-app browser channel, and the redirect protocol it rides on.
 *
 * This is the shared-origin rail for React Native. It exists because shared-origin is for apps that
 * do NOT own the wallet's domain, and that constraint is identical on native — the app cannot host
 * /.well-known files for someone else's rpId, so the ceremony has to run in a context that genuinely
 * is that origin. An in-app browser tab is one. (Measured on device 2026-07-20: PRF evaluates inside
 * both ASWebAuthenticationSession and Chrome Custom Tabs.)
 *
 * What it must get right is everything postMessage gave the web channel for free.
 *
 * MUTATION: drop the `result.kind !== req.kind` check in native.ts and the kind-confusion test fails;
 * drop the size guard in redirect-protocol.ts and the oversized-payload test fails. Verified.
 */
import { describe, it, expect, vi } from "vitest";
import { createNativeChannel, AuthSessionCancelledError } from "../../src/channel/channels/native.js";
import {
  encodeRequestUrl,
  decodeRequestUrl,
  encodeResultUrl,
  decodeResultUrl,
  RedirectPayloadTooLargeError,
} from "../../src/channel/redirect-protocol.js";
import type { ChannelRequest, ChannelResult } from "../../src/channel/channels/port.js";

const AUTH_ORIGIN = "https://wallet.example";
const REDIRECT = "myapp://avok-callback";
const AUTHORIZE: ChannelRequest = { kind: "authorize", nonce: "n1" };

/** A session that replies with whatever the test hands it. */
const session = (reply: (url: string) => { type: string; url?: string }) => vi.fn(async (url: string) => reply(url));

const channelWith = (open: ReturnType<typeof session>) =>
  createNativeChannel({ authOrigin: AUTH_ORIGIN, redirectUri: REDIRECT, openAuthSession: open });

const resultUrl = (result: ChannelResult) => encodeResultUrl({ redirectUri: REDIRECT, result });

describe("the redirect protocol", () => {
  it("round-trips a request through the URL FRAGMENT, not the query", async () => {
    // The fragment is never sent to a server. A signing request contains the transaction a user is
    // about to approve, and it must not land in an access log, a CDN log, or a Referer header.
    const url = encodeRequestUrl({ authOrigin: AUTH_ORIGIN, request: AUTHORIZE, redirectUri: REDIRECT });
    const parsed = new URL(url);

    expect(parsed.search).toBe(""); // nothing in the query
    expect(parsed.hash).not.toBe("");
    expect(decodeRequestUrl(url)).toEqual({ request: AUTHORIZE, redirectUri: REDIRECT });
  });

  it("round-trips a result the same way", () => {
    const result: ChannelResult = { kind: "sign", result: { signature: "0xsig" } as never };
    expect(new URL(resultUrl(result)).search).toBe("");
    expect(decodeResultUrl(resultUrl(result))).toEqual(result);
  });

  it("returns null for a URL carrying no payload, rather than throwing", () => {
    // A page reached directly must be able to say "there is nothing here" without an exception.
    expect(decodeRequestUrl("https://wallet.example/")).toBeNull();
    expect(decodeResultUrl("myapp://avok-callback")).toBeNull();
  });

  it("REFUSES an oversized payload instead of letting it be silently truncated", () => {
    // Chromium replaces over-long URLs with empty invalid ones — a truncation indistinguishable from
    // a user cancelling. Failing loudly turns an unreproducible bug into a clear error.
    const huge: ChannelRequest = { kind: "sign", request: { blob: "x".repeat(9000) } as never };
    expect(() => encodeRequestUrl({ authOrigin: AUTH_ORIGIN, request: huge, redirectUri: REDIRECT })).toThrow(
      RedirectPayloadTooLargeError,
    );
  });
});

describe("createNativeChannel", () => {
  it("opens the auth origin with the request, and returns the decoded result", async () => {
    const open = session((url) => {
      // The wallet page would decode this and run the ceremony.
      expect(decodeRequestUrl(url)?.request).toEqual(AUTHORIZE);
      return {
        type: "success",
        url: resultUrl({ kind: "authorize", account: { evmAddress: "0xabc" } as never, proof: "0xsig" }),
      };
    });

    const result = await channelWith(open).open(AUTHORIZE);
    expect(result.kind).toBe("authorize");
    expect(open).toHaveBeenCalledOnce();
  });

  it("passes the redirectUri to the session, so the OS knows what to intercept", async () => {
    const open = session(() => ({
      type: "success",
      url: resultUrl({ kind: "authorize", account: { evmAddress: "0xabc" } as never, proof: "0xsig" }),
    }));
    await channelWith(open).open(AUTHORIZE);
    expect(open).toHaveBeenCalledWith(expect.stringContaining(AUTH_ORIGIN), REDIRECT);
  });

  it("surfaces a DISMISSED session as its own error, not as a failure", async () => {
    // Changing your mind is the ordinary outcome. An app that cannot tell it from a crash shows an
    // error for a deliberate cancel.
    const open = session(() => ({ type: "cancel" }));
    await expect(channelWith(open).open(AUTHORIZE)).rejects.toBeInstanceOf(AuthSessionCancelledError);
  });

  it("rejects a success with no payload rather than returning undefined", async () => {
    const open = session(() => ({ type: "success", url: REDIRECT }));
    await expect(channelWith(open).open(AUTHORIZE)).rejects.toThrow(/no result/i);
  });

  it("REFUSES a result of a different kind than was asked for", async () => {
    // A callback URL carries no proof of who sent it, so a reply answering a question nobody asked is
    // a confused or hostile session — never a legitimate answer.
    const open = session(() => ({ type: "success", url: resultUrl({ kind: "sign", result: {} as never }) }));
    await expect(channelWith(open).open(AUTHORIZE)).rejects.toThrow(/Expected a "authorize" result/);
  });

  it("refuses a plaintext auth origin at construction, not at the first signature", async () => {
    expect(() =>
      createNativeChannel({
        authOrigin: "http://wallet.example",
        redirectUri: REDIRECT,
        openAuthSession: session(() => ({ type: "cancel" })),
      }),
    ).toThrow(/HTTPS/);
  });

  it("allows http on localhost, for development", () => {
    expect(() =>
      createNativeChannel({
        authOrigin: "http://localhost:3000",
        redirectUri: REDIRECT,
        openAuthSession: session(() => ({ type: "cancel" })),
      }),
    ).not.toThrow();
  });
});
