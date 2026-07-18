// @vitest-environment jsdom
//
// Acceptance (SPEC-03 §6): a STOCK viem wallet client drives the wallet through the provider with
// zero Avok-specific tx code, and a STOCK Wallet Standard consumer discovers the Solana wallet.
import { expect, test, vi } from "vitest";
import { createWalletClient, custom, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { getWallets } from "@wallet-standard/app";
import type { ClientConfig } from "../../src/index.js";
import { createSendEngine, type SendEngine, type SolanaEngine } from "../../src/internal/index.js";
import { getChainProfile } from "../../src/evm/index.js";
import { createEip1193Provider, registerAvokSolanaWallet } from "../../src/provider/index.js";

const ADDR = "0x1111111111111111111111111111111111111111";
const SOL = "So11111111111111111111111111111111111111112";

test("stock viem: getAddresses + signMessage + sendCalls over the provider, no Avok tx code", async () => {
  const signMessage = vi.fn(async () => "0xsig");
  const config = {
    connection: {
      account: () => ({ evm: { address: ADDR }, solana: { address: SOL } }),
      status: () => true,
      signMessage,
    },
  } as unknown as ClientConfig;
  const engine = {
    send: vi.fn(async () => ({ id: "0xbundle", rail: "self-pay", status: "submitted", txHash: "0xbundle", chainId: 8453 })),
    status: vi.fn(async (r: Record<string, unknown>) => ({ ...r, status: "confirmed" })),
  } as unknown as SendEngine;

  const provider = createEip1193Provider(config, { defaultChainId: base.id, engine });
  const wallet = createWalletClient({ chain: base, transport: custom(provider) });

  const [address] = await wallet.getAddresses();
  expect(address?.toLowerCase()).toBe(ADDR);

  const sig = await wallet.signMessage({ account: address!, message: "gm" });
  expect(sig).toBe("0xsig");
  expect(signMessage).toHaveBeenCalledWith({ message: "gm" });

  const result = await wallet.sendCalls({ account: address!, calls: [{ to: ADDR, value: 0n }] });
  const id = typeof result === "string" ? result : result.id;
  expect(id).toBe("0xbundle");
});

test("stock viem: sendCalls with a paymasterService capability drives the 4337 SPONSORED path end-to-end", async () => {
  // The whole Avok stack runs for real (provider → engine → evm.send → UserOp build → 7677 handshake →
  // bundler) against fake bring-your-own infra; the CONSUMER writes zero Avok-specific code.
  const IMPL = "0x1234567890123456789012345678901234567890" as Address;
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
  const chain = { ...getChainProfile(base.id)!, canonicalImplementation: IMPL };

  // A delegated wallet (7702 designator points at IMPL) so no authorization is needed.
  const rpc = {
    getCode: async () => `0xef0100${IMPL.slice(2)}` as Hex,
    readContract: async () => 0n, // EntryPoint getNonce
    getMaxPriorityFeePerGas: async () => 600_000_000n,
    getBaseFeePerGas: async () => 400_000_000n,
    getTransactionReceipt: async () => null,
  } as never;

  let receiptReady = false;
  const bundler = {
    estimateUserOperationGas: async () => ({
      callGasLimit: 100_000n, verificationGasLimit: 120_000n, preVerificationGas: 50_000n,
      paymasterVerificationGasLimit: 20_000n, paymasterPostOpGasLimit: 10_000n,
    }),
    sendUserOperation: vi.fn(async () => "0xuserophash" as Hex),
    getUserOperationReceipt: async () =>
      receiptReady ? { success: true, receipt: { transactionHash: "0xminedtx" as Hex } } : null,
  };
  const paymaster = {
    getPaymasterStubData: async () => ({ paymaster: USDC, paymasterData: "0xstub" as Hex, paymasterVerificationGasLimit: 20_000n, paymasterPostOpGasLimit: 10_000n }),
    getPaymasterData: async () => ({ paymaster: USDC, paymasterData: "0xfinal" as Hex }),
  } as never;

  const config = {
    connection: {
      account: () => ({ evm: { address: ADDR }, solana: { address: SOL } }),
      status: () => true,
      signUserOp: vi.fn(async () => ({ signature: "0xsig" as Hex })),
    },
    paymasterUrl: "https://pm.test",
    bundlerUrl: "https://bundler.test",
    deps: { rpc, bundler: bundler as never, paymaster, chain, oracle: { read: async () => ({ priceE8: 200_000_000_000n }) } },
  } as unknown as ClientConfig;

  const engine: SendEngine = createSendEngine(config);
  const provider = createEip1193Provider(config, { defaultChainId: base.id, engine });
  const wallet = createWalletClient({ chain: base, transport: custom(provider) });

  const { id } = await wallet.sendCalls({
    account: ADDR as Address,
    calls: [{ to: ADDR as Address, value: 0n }],
    capabilities: { paymasterService: { url: "https://pm.test", context: { token: USDC } } },
  });

  // A UserOp was submitted to the bundler, and the bundle id is its userOpHash.
  expect(bundler.sendUserOperation).toHaveBeenCalledOnce();
  expect(id).toContain("0xuserophash");

  // The consumer polls status; it stays pending until the bundler produces a receipt, then confirms.
  const pending = await wallet.getCallsStatus({ id });
  expect(pending.status).toBe("pending");
  receiptReady = true;
  const done = await wallet.getCallsStatus({ id });
  expect(done.status).toBe("success");
});

test("stock Wallet Standard: getWallets() discovers the Avok Solana wallet and its features", () => {
  const engine = {
    account: () => ({ address: SOL, publicKey: new Uint8Array(32).fill(3) }),
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
    signAndSend: vi.fn(),
  } as unknown as SolanaEngine;
  const config = { connection: {} } as unknown as ClientConfig;

  registerAvokSolanaWallet(config, { engine });

  const avok = getWallets()
    .get()
    .find((w) => w.name === "Avok");
  expect(avok).toBeDefined();
  expect(avok!.chains).toContain("solana:mainnet");
  expect(Object.keys(avok!.features)).toEqual(
    expect.arrayContaining([
      "standard:connect",
      "solana:signMessage",
      "solana:signAndSendTransaction",
    ]),
  );
});
