import { describe, expect, it, vi } from "vitest";
import { createSharedOriginConnection } from "../../src/channel/connection.js";
import { loadAccount, memoryStorage } from "../../src/channel/storage.js";
import type { SigningChannel, ChannelRequest } from "../../src/channel/channels/port.js";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { authorizeChallenge } from "../../src/channel/authorize-proof.js";

// ── Helpers ────────────────────────────────────────────────────────────────

// A REAL key, because connect() now verifies the authorize proof by recovering the signer. A canned
// address can no longer pass, which is exactly the property under test.
const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const TEST_SIGNER = privateKeyToAccount(TEST_KEY);
const TEST_ADDRESS = TEST_SIGNER.address as Hex;
const TEST_SOLANA = "AvokSoLDemoAddress11111111111111111111111111";
/** The passkey this account was established with — lets the popup skip the account picker. */
const TEST_CREDENTIAL = "credential-id-abc";
const AUTH_ORIGIN = "https://auth.avok.test";

/**
 * A fake channel whose open():
 * - kind="authorize" → returns the ACCOUNT the popup would postMessage back (#8: no code, no state,
 *   nothing to exchange — the popup ran the ceremony and this is its result).
 * - kind="sign"      → returns a canned signature.
 *
 * Returns the vi.fn() so callers can assert call args.
 */
function makeFakeChannel(): SigningChannel {
  return {
    open: vi.fn().mockImplementation(async (req: ChannelRequest) => {
      if (req.kind === "authorize") {
        // Sign the caller's challenge exactly as a real wallet page would.
        const proof = await TEST_SIGNER.signMessage({
          message: authorizeChallenge({ nonce: req.nonce, authOrigin: AUTH_ORIGIN }),
        });
        return {
          kind: "authorize",
          account: { evmAddress: TEST_ADDRESS, solanaAddress: TEST_SOLANA, credentialId: TEST_CREDENTIAL },
          proof,
        };
      }
      if (req.kind === "sign") {
        return { kind: "sign", result: { signature: "0xdeadbeef" as Hex } };
      }
      throw new Error(`Unexpected channel request kind: ${(req as { kind: string }).kind}`);
    }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────
//
// #8 deleted this connection's OIDC half. The cases that went with it tested PKCE/state/clientId/
// scopes and the `state` CSRF guard — all mechanics of an OIDC REDIRECT that no longer happens.
// The CSRF property itself did NOT go with them: it lives in channels/web.ts, which pins the origin
// it opened AND the exact window it opened, and is covered by channels-web.test.ts ("ignores a
// message from a wrong origin", "Fix 1 — ignores a correct-origin message from a DIFFERENT source").
// Everything below is a behaviour that SURVIVES, ported to the new shape.

describe("createSharedOriginConnection", () => {
  it("connect(): saves the account and returns it", async () => {
    const storage = memoryStorage();
    const conn = createSharedOriginConnection({ authOrigin: AUTH_ORIGIN, channel: makeFakeChannel(), storage });

    const account = await conn.connect();

    expect(account.evmAddress).toBe(TEST_ADDRESS);
    expect(conn.account()?.evmAddress).toBe(TEST_ADDRESS);
    expect(conn.status()).toBe(true);
    expect(loadAccount(storage)?.evmAddress).toBe(TEST_ADDRESS);
  });

  it("account() surfaces solanaAddress and credentialId", async () => {
    const conn = createSharedOriginConnection({
      authOrigin: AUTH_ORIGIN,
      channel: makeFakeChannel(),
      storage: memoryStorage(),
    });
    await conn.connect();

    expect(conn.account()?.solanaAddress).toBe(TEST_SOLANA);
    expect(conn.account()?.credentialId).toBe(TEST_CREDENTIAL);
  });

  it("signMessage(): routes to the channel with the account's credentialId, never a sessionId", async () => {
    // WHY: credentialId used to ride the access token's claims down to the popup. Without it the
    // browser cannot constrain the assertion and the user picks a passkey on EVERY signature.
    const channel = makeFakeChannel();
    const conn = createSharedOriginConnection({ authOrigin: AUTH_ORIGIN, channel, storage: memoryStorage() });
    await conn.connect();

    const sig = await conn.signMessage({ message: "hello avok" });
    expect(sig).toBe("0xdeadbeef");

    const call = (channel.open as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as ChannelRequest;
    expect(call.kind).toBe("sign");
    expect(call).toMatchObject({ credentialId: TEST_CREDENTIAL });
    expect(call).not.toHaveProperty("sessionId");
  });

  it("signSolanaTransaction(): forwards the cluster hint so the origin can enrich SPL consent", async () => {
    const channel = makeFakeChannel();
    const conn = createSharedOriginConnection({ authOrigin: AUTH_ORIGIN, channel, storage: memoryStorage() });
    await conn.connect();

    await conn.signSolanaTransaction(new Uint8Array([1, 2, 3]), { cluster: "devnet" });

    const call = (channel.open as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as ChannelRequest & {
      request: { cluster?: string };
    };
    expect(call.request.cluster).toBe("devnet");
  });

  it("signMessage(): throws if called before connect", async () => {
    const conn = createSharedOriginConnection({
      authOrigin: AUTH_ORIGIN,
      channel: makeFakeChannel(),
      storage: memoryStorage(),
    });
    await expect(conn.signMessage({ message: "hi" })).rejects.toThrow(/Not connected/);
  });

  it("logout(): clears the account from storage and in-memory", async () => {
    const storage = memoryStorage();
    const conn = createSharedOriginConnection({ authOrigin: AUTH_ORIGIN, channel: makeFakeChannel(), storage });
    await conn.connect();

    conn.logout();

    expect(conn.account()).toBeNull();
    expect(conn.status()).toBe(false);
    expect(loadAccount(storage)).toBeNull();
  });

  it("account() re-hydrates from storage on a cold start", async () => {
    // WHY: a reload must not re-prompt for a passkey just to know who you are.
    const storage = memoryStorage();
    const first = createSharedOriginConnection({ authOrigin: AUTH_ORIGIN, channel: makeFakeChannel(), storage });
    await first.connect();

    const cold = createSharedOriginConnection({ authOrigin: AUTH_ORIGIN, channel: makeFakeChannel(), storage });
    expect(cold.account()?.evmAddress).toBe(TEST_ADDRESS);
    expect(cold.status()).toBe(true);
  });
});
