import { expect, test, vi } from "vitest";
import { numberToHex } from "viem";
import type { ClientConfig } from "../../src/index.js";
import type { SendEngine } from "../../src/internal/index.js";
import { createEip1193Provider } from "../../src/provider/eip1193.js";

const ADDR = "0x1111111111111111111111111111111111111111";
const SOL = "SoLaNaAddr11111111111111111111111111111111";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function fakeConfig(): ClientConfig {
  return {
    connection: { account: () => ({ evm: { address: ADDR }, solana: { address: SOL } }), status: () => true },
  } as unknown as ClientConfig;
}

/** A fake engine whose `capabilities` reports sponsored support + fee tokens per chain. */
function fakeEngine(caps: (chainId: number) => { paymasterService: { supported: boolean }; feeTokens: { symbol: string; address: string; decimals: number }[] }) {
  return {
    send: vi.fn(),
    status: vi.fn(),
    capabilities: vi.fn(caps),
  } as unknown as SendEngine & { capabilities: ReturnType<typeof vi.fn> };
}

test("wallet_getCapabilities reports paymasterService + fee tokens for the requested chain", async () => {
  const engine = fakeEngine((chainId) =>
    chainId === 8453
      ? { paymasterService: { supported: true }, feeTokens: [{ symbol: "USDC", address: USDC, decimals: 6 }] }
      : { paymasterService: { supported: false }, feeTokens: [] },
  );
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453, engine });

  const caps = (await p.request({ method: "wallet_getCapabilities", params: [ADDR, [numberToHex(8453)]] })) as Record<
    string,
    { paymasterService?: { supported: boolean }; feeTokens?: unknown[] }
  >;

  expect(caps[numberToHex(8453)]?.paymasterService?.supported).toBe(true);
  expect(caps[numberToHex(8453)]?.feeTokens).toEqual([{ symbol: "USDC", address: USDC, decimals: 6 }]);
});

test("wallet_getCapabilities reports supported:false on a chain with no bundler/paymaster", async () => {
  const engine = fakeEngine(() => ({ paymasterService: { supported: false }, feeTokens: [] }));
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453, engine });

  const caps = (await p.request({ method: "wallet_getCapabilities", params: [ADDR, [numberToHex(10)]] })) as Record<
    string,
    { paymasterService?: { supported: boolean } }
  >;

  expect(caps[numberToHex(10)]?.paymasterService?.supported).toBe(false);
});

test("wallet_getCapabilities defaults to the active chain when no chain ids are given", async () => {
  const engine = fakeEngine(() => ({ paymasterService: { supported: true }, feeTokens: [] }));
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453, engine });

  const caps = (await p.request({ method: "wallet_getCapabilities", params: [ADDR] })) as Record<string, unknown>;

  expect(Object.keys(caps)).toEqual([numberToHex(8453)]);
});
