import { describe, it, expect } from "vitest";
import { createAvokClient } from "./client.js";
import type { Connection, SelfCustodyConnection } from "../types.js";

// Minimal fakes — only the members createAvokClient touches.
function fakeUseOnly(): Connection {
  return {
    custody: "use-only",
    continue: async () => ({ evm: { address: "0x0000000000000000000000000000000000000000" }, solana: { address: "x" } }),
    logout: () => {},
    account: () => null,
    status: () => false,
  } as unknown as Connection;
}
function fakeSelf(): SelfCustodyConnection {
  return { ...fakeUseOnly(), custody: "self", canExport: true,
    create: async () => ({ evm: { address: "0x0" }, solana: { address: "x" } }),
    export: async () => "0xkey", addPasskey: async () => ({ slotId: "0x1", txId: "t", passkeyCount: 2 }),
    pairing: { holder: {}, enroller: {} },
    passkeyCount: () => 1,
  } as unknown as SelfCustodyConnection;
}

describe("custody boundary", () => {
  it("shared-origin client omits management verbs at runtime", () => {
    const client = createAvokClient({ connection: fakeUseOnly() });
    expect("exportEvmKey" in client).toBe(false);
    expect("enrollAccessSlot" in client).toBe(false);
    expect("create" in client).toBe(false);
    expect("registerSubname" in client).toBe(false);
    expect(client.custody).toBe("use-only");
  });
  it("own-origin client has management verbs", () => {
    const client = createAvokClient({ connection: fakeSelf() });
    expect("exportEvmKey" in client).toBe(true);
    expect("enrollAccessSlot" in client).toBe(true);
    expect(client.custody).toBe("self");
  });
});
