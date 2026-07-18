import { expect, test, vi } from "vitest";
import { numberToHex } from "viem";
import type { ClientConfig } from "@avokjs/sdk-core";
import type { SendEngine } from "@avokjs/sdk-core/internal";
import { createEip1193Provider } from "../src/eip1193.js";

const ADDR = "0x1111111111111111111111111111111111111111";
const SOL = "SoLaNaAddr11111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function fakeConfig(): ClientConfig {
  return {
    connection: { account: () => ({ evm: { address: ADDR }, solana: { address: SOL } }), status: () => true },
  } as unknown as ClientConfig;
}

function fakeEngine(defaultFeeTokens: { symbol: string; address: string; decimals: number }[] = []) {
  const send = vi.fn().mockResolvedValue({ id: "0xuserophash", rail: "sponsored", status: "pending", chainId: 8453 });
  return {
    send,
    status: vi.fn(),
    capabilities: vi.fn(() => ({ paymasterService: { supported: true }, feeTokens: defaultFeeTokens })),
  } as unknown as SendEngine & { send: ReturnType<typeof vi.fn>; capabilities: ReturnType<typeof vi.fn> };
}

test("wallet_sendCalls with a paymasterService context token routes sponsored with that token", async () => {
  const engine = fakeEngine();
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453, engine });

  await p.request({
    method: "wallet_sendCalls",
    params: [{
      chainId: numberToHex(8453),
      calls: [{ to: TO, value: numberToHex(1000n), data: "0x" }],
      capabilities: { paymasterService: { url: "https://pm.test", context: { token: USDC } } },
    }],
  });

  expect(engine.send).toHaveBeenCalledWith([{ to: TO, value: 1000n, data: "0x" }], { chainId: 8453, feeToken: USDC });
});

test("wallet_sendCalls with a single-token paymasterService (no context token) uses the chain's default fee token", async () => {
  const engine = fakeEngine([{ symbol: "USDC", address: USDC, decimals: 6 }]);
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453, engine });

  await p.request({
    method: "wallet_sendCalls",
    params: [{
      chainId: numberToHex(8453),
      calls: [{ to: TO, data: "0x" }],
      capabilities: { paymasterService: { url: "https://pm.test" } },
    }],
  });

  expect(engine.send).toHaveBeenCalledWith([{ to: TO, value: 0n, data: "0x" }], { chainId: 8453, feeToken: USDC });
});

test("wallet_sendCalls without a paymasterService capability self-pays (no fee token)", async () => {
  const engine = fakeEngine();
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453, engine });

  await p.request({
    method: "wallet_sendCalls",
    params: [{ chainId: numberToHex(8453), calls: [{ to: TO, data: "0x" }] }],
  });

  expect(engine.send).toHaveBeenCalledWith([{ to: TO, value: 0n, data: "0x" }], { chainId: 8453 });
});
