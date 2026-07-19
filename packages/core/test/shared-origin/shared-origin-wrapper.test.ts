import { describe, it, expect, vi } from "vitest";
import type { StorageAdapter as NetStorage } from "../../src/channel/index.js";
import { createSharedOriginConnection } from "../../src/shared-origin/connection.js";
import { makeFakeChannel } from "../client/fakes.js";

describe("createSharedOriginConnection", () => {
  it("continue() runs the OIDC authorize flow and exposes the account", async () => {
    const channel = makeFakeChannel({
      address: "0xabc...",
      subname: "alice.qudi.fi",
      solanaAddress: "So1anaAddrBase58...",
    });
    const conn = createSharedOriginConnection({
      authOrigin: "https://auth.qudi.fi",
      channel,
    });
    const acct = await conn.continue();
    expect(acct.evm.address.toLowerCase()).toBe("0xabc...".toLowerCase());
    expect(conn.status()).toBe(true);
  });

  it("account() maps the shared-origin session to { evm, solana }", async () => {
    const channel = makeFakeChannel({
      address: "0xabc...",
      subname: "alice.qudi.fi",
      solanaAddress: "So1anaAddrBase58...",
    });
    const conn = createSharedOriginConnection({
      authOrigin: "https://auth.qudi.fi",
      channel,
    });
    await conn.continue();
    const acct = conn.account();
    expect(acct?.evm.address).toMatch(/^0x/);
    expect(acct?.solana.address).toBe("So1anaAddrBase58...");
  });

  // A claim missing from a FRESH login is a live operator misconfiguration (client registered
  // without the `avok` scope — grantScopes() narrows it away silently). Fail loud; clearing it
  // here would disguise a config bug as an ordinary failed sign-in.
  it("continue() throws if a freshly minted session lacks a solana_address claim", async () => {
    const channel = makeFakeChannel({ address: "0xabc...", subname: "alice.qudi.fi" });
    const conn = createSharedOriginConnection({
      authOrigin: "https://auth.qudi.fi",
      channel,
    });
    await expect(conn.continue()).rejects.toThrow(/solana_address/);
  });

  // ...but a RESTORED session missing the claim must NOT throw. account() runs at provider mount,
  // so throwing crashes the app before any UI — including logout() — can render, stranding the user
  // with no in-app recovery (only devtools). This is the state EVERY existing session lands in the
  // first time an operator widens its granted scopes, which is exactly how it was found: live
  // shared-origin demos crashed on load against sessions minted before the `avok` scope was granted.
  describe("a stored account missing solanaAddress is cleared, not thrown", () => {
    // Seeds storage the way an older login would have: a restorable account with no solanaAddress.
    // (#8: the key is `avok.account` and the value is a public address — it was `avok.session` and a
    // token pair. The BEHAVIOUR under test is unchanged: an account sdk-core cannot shape must be
    // purged, not thrown, or the app renders signed-in against something it will refuse to use.)
    function storageWithStaleSession(): NetStorage {
      const map = new Map<string, string>([["avok.account", JSON.stringify({ evmAddress: "0xabc..." })]]);
      return {
        get: (k) => map.get(k) ?? null,
        set: (k, v) => void map.set(k, v),
        remove: (k) => void map.delete(k),
      };
    }

    it("account() returns null instead of throwing", () => {
      const channel = makeFakeChannel({ address: "0xabc..." });
      const conn = createSharedOriginConnection({
        authOrigin: "https://auth.qudi.fi",
        channel,
        storage: storageWithStaleSession(),
      });
      expect(() => conn.account()).not.toThrow();
      expect(conn.account()).toBeNull();
    });

    it("purges the dead session from storage so it is not re-read on the next mount", () => {
      const storage = storageWithStaleSession();
      const channel = makeFakeChannel({ address: "0xabc..." });
      const conn = createSharedOriginConnection({
        authOrigin: "https://auth.qudi.fi",
        channel,
        storage,
      });
      expect(storage.get("avok.account")).not.toBeNull();
      conn.account();
      expect(storage.get("avok.account")).toBeNull();
    });

    // Without the clear, status() would keep reporting a session that account() denies — the app
    // would render as signed-in with no account.
    it("leaves status() reporting signed-out, so the app agrees with account()", () => {
      const channel = makeFakeChannel({ address: "0xabc..." });
      const conn = createSharedOriginConnection({
        authOrigin: "https://auth.qudi.fi",
        channel,
        storage: storageWithStaleSession(),
      });
      conn.account();
      expect(conn.status()).toBe(false);
    });

    // The user must be able to recover by signing in again — the whole point of not throwing.
    it("still allows a fresh continue() to sign in afterwards", async () => {
      const channel = makeFakeChannel({ address: "0xabc...", solanaAddress: "So1anaAddrBase58..." });
      const conn = createSharedOriginConnection({
        authOrigin: "https://auth.qudi.fi",
        channel,
        storage: storageWithStaleSession(),
      });
      expect(conn.account()).toBeNull();
      const acct = await conn.continue();
      expect(acct.solana.address).toBe("So1anaAddrBase58...");
      expect(conn.status()).toBe(true);
    });
  });

  it("signMessage delegates to the remote signer via the channel", async () => {
    const channel = makeFakeChannel({ address: "0xabc...", solanaAddress: "So1anaAddrBase58..." });
    const openSpy = vi.spyOn(channel, "open");
    const conn = createSharedOriginConnection({
      authOrigin: "https://auth.qudi.fi",
      channel,
    });
    await conn.continue();
    const sig = await conn.signMessage({ message: "hello" });
    expect(sig).toMatch(/^0x/);
    // Verify the channel saw a sign request with op:"signMessage"
    const signCall = openSpy.mock.calls.find(
      ([req]) => req.kind === "sign" && (req as { kind: "sign"; request: { op: string } }).request.op === "signMessage",
    );
    expect(signCall).toBeDefined();
  });

  it("logout() clears status and account()", async () => {
    const channel = makeFakeChannel({ address: "0xabc...", solanaAddress: "So1anaAddrBase58..." });
    const conn = createSharedOriginConnection({
      authOrigin: "https://auth.qudi.fi",
      channel,
    });
    await conn.continue();
    expect(conn.status()).toBe(true);
    expect(conn.account()).not.toBeNull();
    conn.logout();
    expect(conn.status()).toBe(false);
    expect(conn.account()).toBeNull();
  });

  it("is a use-only Connection — exposes no custody-management verbs (create/export/addPasskey/canExport)", async () => {
    const channel = makeFakeChannel({ address: "0xabc...", solanaAddress: "So1anaAddrBase58..." });
    const conn = createSharedOriginConnection({
      authOrigin: "https://auth.qudi.fi",
      channel,
    });
    await conn.continue();
    for (const verb of ["create", "export", "addPasskey", "canExport"]) {
      expect(verb in conn).toBe(false);
    }
    expect(conn.custody).toBe("use-only");
  });
});
