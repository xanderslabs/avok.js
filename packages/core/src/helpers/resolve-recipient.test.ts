import { describe, it, expect } from "vitest";
import { resolveRecipient } from "./resolve-recipient.js";

const EVM = "0x1111111111111111111111111111111111111111";
const SOL = "So11111111111111111111111111111111111111112"; // wrapped-SOL mint (valid base58 pubkey)

// #6: resolveRecipient takes a NameResolver, not a client — resolution no longer lives on the
// wallet surface, so this helper is usable by any app that resolves names.
function mock(map: Record<string, { evm?: string; solana?: string } | null>) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      resolveForward: async (n: string) => {
        calls.push(n);
        return (map[n] ?? null) as { evm?: `0x${string}`; solana?: string } | null;
      },
      resolveReverse: async () => null,
    },
  };
}

describe("resolveRecipient", () => {
  it("passes a raw EVM address through without calling the resolver", async () => {
    const m = mock({});
    const r = await resolveRecipient(m.client, EVM, "evm");
    expect(r).toEqual({ address: EVM });
    expect(m.calls).toEqual([]);
  });

  it("passes a raw Solana address through without calling the resolver", async () => {
    const m = mock({});
    const r = await resolveRecipient(m.client, SOL, "solana");
    expect(r).toEqual({ address: SOL });
    expect(m.calls).toEqual([]);
  });

  it("resolves an ENS name to its EVM address on the evm rail", async () => {
    const m = mock({ "alice.eth": { evm: EVM } });
    const r = await resolveRecipient(m.client, "alice.eth", "evm");
    expect(r).toEqual({ address: EVM, resolvedFrom: "alice.eth" });
  });

  it("resolves an SNS name to its Solana address on the solana rail", async () => {
    const m = mock({ "alice.sol": { solana: SOL } });
    const r = await resolveRecipient(m.client, "alice.sol", "solana");
    expect(r).toEqual({ address: SOL, resolvedFrom: "alice.sol" });
  });

  it("errors with a wrong-rail hint when a name resolves only to the other chain", async () => {
    const m = mock({ "alice.sol": { solana: SOL } });
    const r = await resolveRecipient(m.client, "alice.sol", "evm");
    expect("error" in r && r.error).toMatch(/Solana address/);
  });

  it("errors when a name resolves to nothing", async () => {
    const m = mock({ "ghost.eth": null });
    const r = await resolveRecipient(m.client, "ghost.eth", "evm");
    expect("error" in r && r.error).toMatch(/No address found/);
  });

  it("errors on empty input", async () => {
    const r = await resolveRecipient(mock({}).client, "  ", "evm");
    expect("error" in r && r.error).toMatch(/Enter a recipient/);
  });

  it("errors on a non-address, non-name string", async () => {
    const r = await resolveRecipient(mock({}).client, "hello", "evm");
    expect("error" in r && r.error).toMatch(/valid 0x address or a name/);
  });
});
