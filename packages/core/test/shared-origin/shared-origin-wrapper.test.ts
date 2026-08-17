import { describe, it, expect, vi } from "vitest";
import { createSharedOriginConnection } from "../../src/shared-origin/connection.js";
import { makeFakeChannel } from "../client/fakes.js";

describe("createSharedOriginConnection", () => {
  it("continue() runs the OIDC authorize flow and exposes the account", async () => {
    const channel = makeFakeChannel();
    const conn = createSharedOriginConnection({
      originPoint: "https://auth.qudi.fi",
      channel,
    });
    const acct = await conn.continue();
    expect(acct.evm.address).toBe(channel.address);
    expect(conn.status()).toBe(true);
  });

  it("account() maps the shared-origin session to { evm }", async () => {
    const channel = makeFakeChannel();
    const conn = createSharedOriginConnection({
      originPoint: "https://auth.qudi.fi",
      channel,
    });
    await conn.continue();
    const acct = conn.account();
    expect(acct?.evm.address).toMatch(/^0x/);
  });

  it("signMessage delegates to the remote signer via the channel", async () => {
    const channel = makeFakeChannel();
    const openSpy = vi.spyOn(channel, "open");
    const conn = createSharedOriginConnection({
      originPoint: "https://auth.qudi.fi",
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
    const channel = makeFakeChannel();
    const conn = createSharedOriginConnection({
      originPoint: "https://auth.qudi.fi",
      channel,
    });
    await conn.continue();
    expect(conn.status()).toBe(true);
    expect(conn.account()).not.toBeNull();
    conn.logout();
    expect(conn.status()).toBe(false);
    expect(conn.account()).toBeNull();
  });

  it("exposes no custody-management verbs (create/export/addPasskey/canExport)", async () => {
    const channel = makeFakeChannel();
    const conn = createSharedOriginConnection({
      originPoint: "https://auth.qudi.fi",
      channel,
    });
    await conn.continue();
    for (const verb of ["create", "export", "addPasskey", "canExport"]) {
      expect(verb in conn).toBe(false);
    }
  });
});
