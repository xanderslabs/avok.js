import { describe, it, expect, vi } from "vitest";
import { createAvokClient } from "../../src/client/client.js";
import type { Connection } from "../../src/types.js";

function fakeConnection(): Connection {
  let acct: unknown = null;
  let st = false;
  return {
    continue: async () => {
      acct = { evm: { address: "0xabc" } };
      st = true;
      return acct;
    },
    logout: () => {
      acct = null;
      st = false;
    },
    account: () => acct,
    status: () => st,
  } as unknown as Connection;
}

describe("client.subscribe", () => {
  it("notifies listeners after login/logout and stops after unsubscribe", async () => {
    const client = createAvokClient({ connection: fakeConnection() });
    const cb = vi.fn();
    const unsub = client.subscribe(cb);

    await client.login();
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
});
