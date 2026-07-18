import { expect, test } from "vitest";
import { isDelegatedTo, resolveBatch } from "../src/resolve.js";
import { getChainProfile } from "@avokjs/contracts";
import { FakeRpcClient } from "./fakes.js";

const OP = getChainProfile(10)!;
const IMPL = "0x000000000000000000000000000000000000abcd" as const;
const ADDR = "0x1111111111111111111111111111111111111111" as const;
const USDC = Object.keys(OP.tokens)[0] as `0x${string}`;
const USER_CALL = { to: "0x2222222222222222222222222222222222222222" as const, value: 0n, data: "0x" as const };

const chain = { ...OP, canonicalImplementation: IMPL };

test("isDelegatedTo matches the 0xef0100‖impl designator", () => {
  expect(isDelegatedTo(("0xef0100" + IMPL.slice(2)) as `0x${string}`, IMPL)).toBe(true);
  expect(isDelegatedTo("0x", IMPL)).toBe(false);
});

test("self-pay, delegated, blob on anchor → no feeCall, no auth, no disclosures", async () => {
  const rpc = new FakeRpcClient({ code: { [ADDR.toLowerCase()]: ("0xef0100" + IMPL.slice(2)) as `0x${string}` } });
  const batch = await resolveBatch({
    rpc, chain, address: ADDR, credentialId: "cred", userCalls: [USER_CALL],
    ctx: { chainId: 10 }, nonce: 1n, deadline: 99n,
  });
  expect(batch.rail).toBe("self-pay");
  expect(batch.feeCalls).toEqual([]);
  expect(batch.userCalls).toEqual([USER_CALL]);
  expect(batch.authorization).toBeUndefined();
  expect(batch.disclosures).toEqual([]);
});

test("sponsored (4337), undelegated → authorization + delegation disclosure, NO feeCall (paymaster charges the fee)", async () => {
  const rpc = new FakeRpcClient({
    // account undelegated (absent → "0x"); the canonical impl IS deployed on this chain.
    code: { [IMPL.toLowerCase()]: "0x6080604052" as `0x${string}` },
    nonces: { [ADDR]: 7 },
  });
  const batch = await resolveBatch({
    rpc, chain, address: ADDR, credentialId: "cred", userCalls: [USER_CALL],
    ctx: { chainId: 10, feeToken: USDC }, nonce: 1n, deadline: 99n,
  });
  expect(batch.rail).toBe("sponsored");
  expect(batch.authorization).toEqual({ chainId: 10, address: IMPL, nonce: 7 });
  // The 4337 paymaster sponsors the gas and charges the user — no fee call is priced here.
  expect(batch.feeCalls).toEqual([]);
  expect(batch.feeToken?.toLowerCase()).toBe(USDC.toLowerCase());
  expect(batch.disclosures.map((d) => d.kind)).toEqual(["delegation"]);
});

test("undelegated + canonicalImplementation not deployed on this chain → throws (no codeless delegation)", async () => {
  // account undelegated AND the impl address has no code on this chain (absent → "0x").
  const rpc = new FakeRpcClient({ code: {}, nonces: { [ADDR]: 7 } });
  await expect(
    resolveBatch({
      rpc, chain, address: ADDR, credentialId: "cred", userCalls: [USER_CALL],
      ctx: { chainId: 10 }, nonce: 1n, deadline: 99n,
    }),
  ).rejects.toThrow(/not deployed on chain 10/);
});
