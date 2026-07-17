import { expect, test, vi } from "vitest";
import { numberToHex } from "viem";
import type { ClientConfig } from "@avokjs/sdk-core";
import type { SendEngine } from "@avokjs/sdk-core/internal";
import { createEip1193Provider } from "../src/eip1193.js";

const ADDR = "0x1111111111111111111111111111111111111111";
const SOL = "SoLaNaAddr11111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";

function fakeConfig(): ClientConfig {
  return {
    connection: {
      account: () => ({ evm: { address: ADDR }, solana: { address: SOL } }),
      status: () => true,
    },
  } as unknown as ClientConfig;
}

/** A fake send engine: records the call, returns a self-pay receipt, confirms on status. */
function fakeEngine() {
  const send = vi.fn().mockResolvedValue({
    id: "0xtxhash",
    rail: "self-pay",
    status: "submitted",
    txHash: "0xtxhash",
    chainId: 8453,
  });
  const status = vi.fn().mockImplementation(async (r: { [k: string]: unknown }) => ({ ...r, status: "confirmed" }));
  return { send, status } as unknown as SendEngine & { send: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> };
}

test("wallet_sendCalls maps the batch to the engine and returns { id }", async () => {
  const engine = fakeEngine();
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453, engine });
  const out = await p.request({
    method: "wallet_sendCalls",
    params: [{ version: "2.0.0", from: ADDR, chainId: numberToHex(8453), calls: [{ to: TO, value: numberToHex(1000n), data: "0x" }] }],
  });
  expect(out).toEqual({ id: "0xtxhash" });
  expect(engine.send).toHaveBeenCalledWith([{ to: TO, value: 1000n, data: "0x" }], { chainId: 8453 });
});

test("wallet_getCallsStatus returns a 200 status object with receipts once mined", async () => {
  const engine = fakeEngine();
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453, engine });
  const { id } = (await p.request({
    method: "wallet_sendCalls",
    params: [{ calls: [{ to: TO, data: "0x" }], chainId: numberToHex(8453) }],
  })) as { id: string };
  const status = (await p.request({ method: "wallet_getCallsStatus", params: [id] })) as {
    status: number;
    receipts: { status: string; transactionHash: string }[];
  };
  expect(status.status).toBe(200);
  expect(status.receipts[0]).toMatchObject({ status: "0x1", transactionHash: "0xtxhash" });
});

test("eth_sendTransaction wraps one call into wallet_sendCalls and returns the tx hash", async () => {
  const engine = fakeEngine();
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453, engine });
  const hash = await p.request({
    method: "eth_sendTransaction",
    params: [{ from: ADDR, to: TO, value: numberToHex(5n), data: "0x" }],
  });
  expect(hash).toBe("0xtxhash");
  expect(engine.send).toHaveBeenCalledWith([{ to: TO, value: 5n, data: "0x" }], { chainId: 8453 });
});

test("wallet_switchEthereumChain updates the active chain and emits chainChanged", async () => {
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453, engine: fakeEngine() });
  const onChain = vi.fn();
  p.on("chainChanged", onChain);
  const ret = await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xa" }] });
  expect(ret).toBeNull();
  expect(onChain).toHaveBeenCalledWith("0xa");
  expect(await p.request({ method: "eth_chainId" })).toBe("0xa");
});
