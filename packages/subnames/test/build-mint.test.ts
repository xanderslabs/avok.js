import { describe, it, expect, vi } from "vitest";
import { buildSubnameMintCalls, ENS_SUBNAME_CHAIN_ID } from "../src/build-mint.js";

const REGISTRAR = "0x1111111111111111111111111111111111111111" as const;
const OWNER = "0x2222222222222222222222222222222222222222" as const;
const FEE_TOKEN = "0x3333333333333333333333333333333333333333" as const;
const TREASURY = "0x4444444444444444444444444444444444444444" as const;
const VOUCHER = { owner: OWNER, expiry: 9999999999n, signature: "0xdead" as const };

function fakeClient(fee: readonly [string, bigint, string]) {
  return {
    readContract: vi.fn(async () => fee),
    getEnsName: vi.fn(async () => null),
    getEnsAddress: vi.fn(async () => null),
  } as never;
}

describe("buildSubnameMintCalls (build-only — never sends)", () => {
  it("mints on Ethereum L1 mainnet", () => {
    // WHY: ENS subnames ALWAYS mint on mainnet regardless of the app's active chain.
    expect(ENS_SUBNAME_CHAIN_ID).toBe(1);
  });

  it("omits the approve when the mint fee is zero", async () => {
    // WHY: a price-0 registrar is free; a spurious approve(0) would cost gas and confuse the user.
    const { calls } = await buildSubnameMintCalls({
      label: "alice", owner: OWNER, parent: "myapp.eth", registrar: REGISTRAR,
      client: fakeClient([FEE_TOKEN, 0n, TREASURY]), voucher: VOUCHER,
    });
    expect(calls.every((c) => c.to.toLowerCase() !== FEE_TOKEN.toLowerCase())).toBe(true);
  });

  it("PREPENDS an ERC-20 approve when the registrar charges a fee", async () => {
    // WHY: the registrar PULLS the fee during mint. If the approve does not land FIRST in the
    // same batch, the mint reverts. Order is the contract, not a detail.
    const { calls } = await buildSubnameMintCalls({
      label: "alice", owner: OWNER, parent: "myapp.eth", registrar: REGISTRAR,
      client: fakeClient([FEE_TOKEN, 1000n, TREASURY]), voucher: VOUCHER,
    });
    expect(calls[0].to.toLowerCase()).toBe(FEE_TOKEN.toLowerCase());
    expect(calls.length).toBeGreaterThanOrEqual(3); // approve + mint + setPrimary
  });

  it("returns the normalized full name", async () => {
    const { name } = await buildSubnameMintCalls({
      label: "Alice", owner: OWNER, parent: "myapp.eth", registrar: REGISTRAR,
      client: fakeClient([FEE_TOKEN, 0n, TREASURY]), voucher: VOUCHER,
    });
    expect(name).toBe("alice.myapp.eth");
  });

  it("appends the coinType-501 record when a Solana address is supplied", async () => {
    // WHY: the whole point of the enrichment — ONE subname forward-resolves to BOTH chains.
    const withSol = await buildSubnameMintCalls({
      label: "alice", owner: OWNER, parent: "myapp.eth", registrar: REGISTRAR,
      client: fakeClient([FEE_TOKEN, 0n, TREASURY]), voucher: VOUCHER,
      solanaAddress: "36Dn3RWhB8x4c83W6ebQ2C2eH9sh5bQX2nMdkP2cWaA4",
    });
    const withoutSol = await buildSubnameMintCalls({
      label: "alice", owner: OWNER, parent: "myapp.eth", registrar: REGISTRAR,
      client: fakeClient([FEE_TOKEN, 0n, TREASURY]), voucher: VOUCHER,
    });
    expect(withSol.calls.length).toBe(withoutSol.calls.length + 1);
  });

  it("builds an open-claim mint when no voucher is supplied", async () => {
    const { calls } = await buildSubnameMintCalls({
      label: "alice", owner: OWNER, parent: "myapp.eth", registrar: REGISTRAR,
      client: fakeClient([FEE_TOKEN, 0n, TREASURY]),
    });
    expect(calls.length).toBeGreaterThanOrEqual(2); // mint + setPrimary
  });
});
