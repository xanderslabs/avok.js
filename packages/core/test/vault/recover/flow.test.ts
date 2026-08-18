import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { startRecoveryFlow } from "../../../src/vault/recover/flow.js";
import { readGuardianState } from "../../../src/vault/recover/read.js";
import type { RpcClient } from "../../../src/evm/rpc.js";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const GUARDIAN_A = "0x2222222222222222222222222222222222222222" as Address;
const GUARDIAN_B = "0x3333333333333333333333333333333333333333" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const PROMOTE_KEY = "0x4444444444444444444444444444444444444444" as Address;

function fakeRpc(readContract: RpcClient["readContract"]): RpcClient {
  return {
    chainId: async () => 10,
    getCode: async () => "0x",
    getTransactionCount: async () => 0,
    simulateCalls: async () => [],
    call: async () => "0x",
    estimateGas: async () => 0n,
    getGasPrice: async () => 0n,
    getBaseFeePerGas: async () => 0n,
    getMaxPriorityFeePerGas: async () => 0n,
    readContract,
    getBalance: async () => 0n,
    sendRawTransaction: async () => "0x" as Hex,
    getTransactionReceipt: async () => null,
  };
}

function rpcWith(config: unknown[], pending: unknown[]): RpcClient {
  return fakeRpc(async (args) => {
    if (args.functionName === "getGuardianConfig") return config as never;
    if (args.functionName === "getPendingRecovery") return pending as never;
    throw new Error(`unexpected readContract call: ${args.functionName}`);
  });
}

describe("readGuardianState", () => {
  it("reads the guardian roster/threshold/delays", async () => {
    const rpc = rpcWith([[GUARDIAN_A, GUARDIAN_B], 2, 86400, 43200], [ZERO_ADDRESS, 0n, 0, 0]);
    const { config } = await readGuardianState(rpc, WALLET);
    expect(config).toEqual({
      guardians: [GUARDIAN_A, GUARDIAN_B],
      threshold: 2,
      recoveryDelaySeconds: 86400,
      guardianOpDelaySeconds: 43200,
    });
  });

  it("pending is null when promoteKey is the zero address — not a placeholder recovery", async () => {
    const rpc = rpcWith([[GUARDIAN_A], 1, 86400, 43200], [ZERO_ADDRESS, 0n, 0, 0]);
    const { pending } = await readGuardianState(rpc, WALLET);
    expect(pending).toBeNull();
  });

  it("pending is populated once a recovery has at least one approval", async () => {
    const rpc = rpcWith([[GUARDIAN_A, GUARDIAN_B], 2, 86400, 43200], [PROMOTE_KEY, 3n, 1, 0]);
    const { pending } = await readGuardianState(rpc, WALLET);
    expect(pending).toEqual({ promoteKey: PROMOTE_KEY, nonce: 3n, approvals: 1, readyAt: 0 });
  });
});

describe("startRecoveryFlow", () => {
  it("enterWallet: a raw address passes through unchanged (checksummed)", async () => {
    const flow = startRecoveryFlow({ rpc: fakeRpc(async () => [] as never), resolveName: async () => null });
    const { wallet } = await flow.enterWallet(WALLET);
    expect(wallet.toLowerCase()).toBe(WALLET.toLowerCase());
  });

  it("enterWallet: a name resolves via the injected resolver", async () => {
    const flow = startRecoveryFlow({
      rpc: fakeRpc(async () => [] as never),
      resolveName: async (name) => (name === "alice.eth" ? WALLET : null),
    });
    const { wallet } = await flow.enterWallet("alice.eth");
    expect(wallet.toLowerCase()).toBe(WALLET.toLowerCase());
  });

  it("enterWallet: an unresolvable name throws rather than silently proceeding with nothing", async () => {
    const flow = startRecoveryFlow({ rpc: fakeRpc(async () => [] as never), resolveName: async () => null });
    await expect(flow.enterWallet("nobody.eth")).rejects.toThrow(/could not resolve/i);
  });

  it("readGuardianState delegates through to the wallet contract read", async () => {
    const rpc = rpcWith([[GUARDIAN_A], 1, 86400, 43200], [ZERO_ADDRESS, 0n, 0, 0]);
    const flow = startRecoveryFlow({ rpc, resolveName: async () => null });
    const { config } = await flow.readGuardianState(WALLET);
    expect(config.guardians).toEqual([GUARDIAN_A]);
  });

  it("vetoView: canVeto is true only when something is actually pending", async () => {
    const nothingPending = startRecoveryFlow({
      rpc: rpcWith([[GUARDIAN_A], 1, 86400, 43200], [ZERO_ADDRESS, 0n, 0, 0]),
      resolveName: async () => null,
    });
    expect((await nothingPending.vetoView(WALLET)).canVeto).toBe(false);

    const somethingPending = startRecoveryFlow({
      rpc: rpcWith([[GUARDIAN_A], 1, 86400, 43200], [PROMOTE_KEY, 3n, 1, 12345]),
      resolveName: async () => null,
    });
    const view = await somethingPending.vetoView(WALLET);
    expect(view.canVeto).toBe(true);
    expect(view.pending?.readyAt).toBe(12345);
  });
});
