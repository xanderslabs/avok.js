import { describe, expect, test } from "vitest";
import { getAddress } from "viem";
import { createEnsRegistrar } from "../src/ens-registrar.js";

const REGISTRAR = getAddress("0x00000000000000000000000000000000000000aa");
const OWNER = getAddress("0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c");
const SOL = "36Dn3RWhB8x4c83W6ebQ2C2eH9sh5bQX2nMdkP2cWaA4";

function fakeClient(over: Record<string, unknown> = {}) {
  return {
    readContract: async () => getAddress("0x0000000000000000000000000000000000000000"),
    getEnsAddress: async () => OWNER,
    getEnsName: async () => "alice.qudiid.eth",
    ...over,
  } as never;
}

// #6: the resolution cases that used to live here moved with the code to
// @avokjs/helpers (test/ens-resolver.test.ts). What is left is registration.
describe("createEnsRegistrar", () => {
  test("buildMint returns registerWithVoucher + coinType-501 enrichment when solanaAddress given", () => {
    const svc = createEnsRegistrar({ chainId: 1, parent: "qudiid.eth", registrar: REGISTRAR, client: fakeClient() });
    const mint = svc.buildMint({
      label: "alice",
      owner: OWNER,
      solanaAddress: SOL,
      voucher: { label: "alice", owner: OWNER, expiry: 42n },
      signature: "0xdead",
    });
    expect(mint.chain).toBe("evm");
    if (mint.chain !== "evm") throw new Error("expected evm");
    expect(mint.calls.length).toBe(2); // registerWithVoucher + setAddr(501)
  });

  test("buildMint omits the enrichment call when no solanaAddress", () => {
    const svc = createEnsRegistrar({ chainId: 1, parent: "qudiid.eth", registrar: REGISTRAR, client: fakeClient() });
    const mint = svc.buildMint({ label: "alice", owner: OWNER, voucher: { label: "alice", owner: OWNER, expiry: 42n }, signature: "0xdead" });
    if (mint.chain !== "evm") throw new Error("expected evm");
    expect(mint.calls.length).toBe(1);
  });

  test("buildMint throws without a voucher", () => {
    const svc = createEnsRegistrar({ chainId: 1, parent: "qudiid.eth", registrar: REGISTRAR, client: fakeClient() });
    expect(() => svc.buildMint({ label: "alice", owner: OWNER })).toThrow(/voucher/);
  });

  test("isAvailable works without a registrar; buildMint then throws", async () => {
    const svc = createEnsRegistrar({ chainId: 1, parent: "qudiid.eth", client: fakeClient() });
    expect(await svc.isAvailable("alice.qudiid.eth")).toBe(true);
    expect(() =>
      svc.buildMint({ label: "alice", owner: OWNER, voucher: { label: "alice", owner: OWNER, expiry: 42n }, signature: "0xdead" }),
    ).toThrow(/registrar/);
  });

  test("suffix is the parent with a leading dot", () => {
    const svc = createEnsRegistrar({ chainId: 1, parent: "qudiid.eth", registrar: REGISTRAR, client: fakeClient() });
    expect(svc.suffix).toBe(".qudiid.eth");
  });

  test("no parent → suffix defaults to .eth and buildMint throws", () => {
    const svc = createEnsRegistrar({ chainId: 1, client: fakeClient() });
    expect(svc.suffix).toBe(".eth");
    expect(() =>
      svc.buildMint({ label: "x", owner: OWNER, voucher: { label: "x", owner: OWNER, expiry: 42n }, signature: "0xdead" }),
    ).toThrow(/parent/);
  });
});
