import { describe, it, expect } from "vitest";
import { resolveRecipient } from "../../src/helpers/resolve-recipient.js";

const EVM = "0x1111111111111111111111111111111111111111";

// resolveRecipient takes a NameResolver, not a client — resolution does not live on the wallet
// surface, so this helper is usable by any app that resolves names.
function mock(map: Record<string, { evm?: string } | null>) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      resolveForward: async (n: string) => {
        calls.push(n);
        return (map[n] ?? null) as { evm?: `0x${string}` } | null;
      },
      resolveReverse: async () => null,
    },
  };
}

describe("resolveRecipient", () => {
  it("passes a raw EVM address through without calling the resolver", async () => {
    const m = mock({});
    const r = await resolveRecipient(m.client, EVM);
    expect(r).toEqual({ address: EVM });
    expect(m.calls).toEqual([]);
  });

  it("resolves an ENS name to its EVM address", async () => {
    const m = mock({ "alice.eth": { evm: EVM } });
    const r = await resolveRecipient(m.client, "alice.eth");
    expect(r).toEqual({ address: EVM, resolvedFrom: "alice.eth" });
  });

  it("errors when a name resolves to nothing", async () => {
    const m = mock({ "ghost.eth": null });
    const r = await resolveRecipient(m.client, "ghost.eth");
    expect("error" in r && r.error).toMatch(/No address found/);
  });

  it("errors when a name resolves but carries no EVM address", async () => {
    const m = mock({ "alice.eth": {} });
    const r = await resolveRecipient(m.client, "alice.eth");
    expect("error" in r && r.error).toMatch(/No EVM address found/);
  });

  it("errors on empty input", async () => {
    const r = await resolveRecipient(mock({}).client, "  ");
    expect("error" in r && r.error).toMatch(/Enter a recipient/);
  });

  it("errors on a non-address, non-name string", async () => {
    const r = await resolveRecipient(mock({}).client, "hello");
    expect("error" in r && r.error).toMatch(/valid 0x address or a name/);
  });
});
