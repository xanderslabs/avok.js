import { describe, it, expect, vi } from "vitest";
import { createAvokClient } from "./client.js";
import type { Connection, SelfCustodyConnection } from "../types.js";

function fakeSelf(): SelfCustodyConnection {
  let acct: unknown = null;
  let st = false;
  const set = () => { acct = { evm: { address: "0xabc" }, solana: { address: "x" } }; st = true; return acct; };
  return {
    custody: "self", canExport: true,
    continue: async () => set(),
    create: async () => set(),
    logout: () => { acct = null; st = false; },
    account: () => acct,
    status: () => st,
    export: async () => "0xkey",
    addPasskey: async () => ({ passkeyCount: 2 }),
    pairing: { holder: {}, enroller: {} },
    passkeyCount: () => 1,
  } as unknown as SelfCustodyConnection;
}

describe("client.subscribe", () => {
  it("notifies listeners after create/continue/logout and stops after unsubscribe", async () => {
    const client = createAvokClient({ connection: fakeSelf() });
    const cb = vi.fn();
    const unsub = client.subscribe(cb);

    await client.create();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(client.status()).toBe(true);

    await client.logout();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(client.status()).toBe(false);

    await client.login();
    expect(cb).toHaveBeenCalledTimes(3);

    unsub();
    await client.logout();
    expect(cb).toHaveBeenCalledTimes(3); // silent after unsubscribe
  });

  it("shared-origin (use-only) client also exposes subscribe and fires on continue", async () => {
    const conn = {
      custody: "use-only",
      continue: async () => ({ evm: { address: "0x0" }, solana: { address: "x" } }),
      logout: () => {},
      account: () => null,
      status: () => false,
    } as unknown as Connection;
    const client = createAvokClient({ connection: conn });
    const cb = vi.fn();
    client.subscribe(cb);
    await client.login();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
