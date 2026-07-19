import { expect, test } from "vitest";
import { FakeRpcClient } from "./fakes.js";
import { createViemRpcClient, type ViemLike } from "./rpc.js";

test("FakeRpcClient returns programmed getCode and receipt", async () => {
  const rpc = new FakeRpcClient({
    code: { "0x1111111111111111111111111111111111111111": "0xef0100abc" },
    receipts: { "0xdead": { status: "success", transactionHash: "0xdead" } },
  });
  expect(await rpc.getCode("0x1111111111111111111111111111111111111111")).toBe("0xef0100abc");
  expect(await rpc.getCode("0x2222222222222222222222222222222222222222")).toBe("0x");
  expect((await rpc.getTransactionReceipt("0xdead"))?.status).toBe("success");
  expect(await rpc.getTransactionReceipt("0xbeef")).toBeNull();
});

// --- createViemRpcClient adapter tests ---

function makeStub(overrides: Partial<ViemLike> = {}): ViemLike {
  const unused = async () => { throw new Error("unused"); };
  return {
    getChainId: unused as unknown as () => Promise<number>,
    getCode: async () => undefined,
    getTransactionCount: unused as unknown as (args: { address: `0x${string}` }) => Promise<number>,
    simulateCalls: unused as unknown as ViemLike["simulateCalls"],
    call: unused as unknown as ViemLike["call"],
    estimateGas: unused as unknown as ViemLike["estimateGas"],
    getGasPrice: unused as unknown as () => Promise<bigint>,
    estimateMaxPriorityFeePerGas: unused as unknown as () => Promise<bigint>,
    getBlock: unused as unknown as ViemLike["getBlock"],
    getBalance: async () => 10n ** 18n,
    readContract: unused as unknown as ViemLike["readContract"],
    sendRawTransaction: unused as unknown as ViemLike["sendRawTransaction"],
    getTransactionReceipt: async () => { throw new Error("not found"); },
    getBlockNumber: unused as unknown as () => Promise<bigint>,
    ...overrides,
  };
}

test("createViemRpcClient: getCode returns '0x' when viem returns undefined", async () => {
  const stub = makeStub({ getCode: async () => undefined });
  const rpc = createViemRpcClient(stub);
  expect(await rpc.getCode("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe("0x");
});

test("createViemRpcClient: getTransactionReceipt returns null when viem throws", async () => {
  const stub = makeStub({
    getTransactionReceipt: async () => { throw new Error("TransactionReceiptNotFoundError"); },
  });
  const rpc = createViemRpcClient(stub);
  expect(await rpc.getTransactionReceipt("0xdeadbeef" as `0x${string}`)).toBeNull();
});

test("createViemRpcClient: estimateGas forwards from as account", async () => {
  const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
  const to = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
  let capturedAccount: `0x${string}` | undefined;

  const stub = makeStub({
    estimateGas: async (args) => {
      capturedAccount = args.account;
      return 21000n;
    },
  });
  const rpc = createViemRpcClient(stub);
  const result = await rpc.estimateGas({ from, to });
  expect(capturedAccount).toBe(from);
  expect(result).toBe(21000n);
});
