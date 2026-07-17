import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { createViemRpcClient, type ViemLike } from "../src/rpc.js";

const TO = "0x1111111111111111111111111111111111111111" as Address;

it("forwards authorizationList to the viem estimateGas call", async () => {
  let seen: Record<string, unknown> | undefined;
  const viem = {
    estimateGas: async (a: Record<string, unknown>) => { seen = a; return 123n; },
  } as unknown as ViemLike;
  const rpc = createViemRpcClient(viem);
  const authList = [{ address: TO, chainId: 8453, nonce: 0 }];
  const gas = await rpc.estimateGas({ to: TO, data: "0x" as Hex, authorizationList: authList });
  expect(gas).toBe(123n);
  expect(seen?.authorizationList).toEqual(authList);
});
