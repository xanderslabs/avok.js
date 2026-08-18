import { render, screen, act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { AvokProvider, useDevices, useGuardians } from "../src/index.js";
import type { AvokClient, RpcClient } from "../src/index.js";

afterEach(cleanup);

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const DEVICE = "0x2222222222222222222222222222222222222222" as const;
const GUARDIAN = "0x3333333333333333333333333333333333333333" as const;

function makeFakeClient(loggedIn: boolean): AvokClient {
  return {
    subscribe: () => () => {},
    login: async () => ({ evm: { address: WALLET } }),
    logout: () => {},
    account: () => (loggedIn ? { evm: { address: WALLET } } : null),
    status: () => loggedIn,
    isActivated: async () => false,
  } as unknown as AvokClient;
}

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
    sendRawTransaction: async () => "0x",
    getTransactionReceipt: async () => null,
  } as unknown as RpcClient;
}

const wrapperFor = (client: AvokClient) => {
  return ({ children }: { children: ReactNode }) => createElement(AvokProvider, { client, children });
};

describe("useDevices", () => {
  it("devices is null until refresh()", () => {
    const rpc = fakeRpc(async () => [] as never);
    const { result } = renderHook(() => useDevices(rpc), { wrapper: wrapperFor(makeFakeClient(true)) });
    expect(result.current.devices).toBeNull();
  });

  it("refresh() populates devices from the roster read", async () => {
    const { encodeAbiParameters } = await import("viem");
    const publicKey = encodeAbiParameters([{ type: "address" }], [DEVICE]);
    const rpc = fakeRpc(async (args) => {
      if (args.functionName === "keyCount") return 1n as never;
      if (args.functionName === "keyAt") return [2, publicKey] as never;
      throw new Error(`unexpected: ${args.functionName}`);
    });
    const { result } = renderHook(() => useDevices(rpc), { wrapper: wrapperFor(makeFakeClient(true)) });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.devices).toHaveLength(1);
    expect(result.current.devices?.[0]?.address?.toLowerCase()).toBe(DEVICE.toLowerCase());
    expect(result.current.error).toBeNull();
  });

  it("refresh() surfaces an error when no account is active, rather than reading an undefined wallet", async () => {
    const rpc = fakeRpc(async () => [] as never);
    const { result } = renderHook(() => useDevices(rpc), { wrapper: wrapperFor(makeFakeClient(false)) });

    await act(async () => {
      await result.current.refresh().catch(() => {});
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/no account is active/i);
  });

  it("buildRegisterCall/buildRevokeCall target the wallet's own address — never sent by the hook itself", () => {
    const rpc = fakeRpc(async () => [] as never);
    const { result } = renderHook(() => useDevices(rpc), { wrapper: wrapperFor(makeFakeClient(true)) });

    const registerCall = result.current.buildRegisterCall(DEVICE);
    expect(registerCall.to).toBe(WALLET);
    expect(registerCall.value).toBe(0n);

    const revokeCall = result.current.buildRevokeCall(`0x${"00".repeat(32)}`);
    expect(revokeCall.to).toBe(WALLET);
  });
});

describe("useGuardians", () => {
  it("guardians/pendingOp are null until refresh()", () => {
    const rpc = fakeRpc(async () => [] as never);
    const { result } = renderHook(() => useGuardians(rpc), { wrapper: wrapperFor(makeFakeClient(true)) });
    expect(result.current.guardians).toBeNull();
    expect(result.current.pendingOp).toBeNull();
  });

  it("refresh() populates guardians and pendingOp from the guardian-state read", async () => {
    const ZERO = "0x0000000000000000000000000000000000000000";
    const rpc = fakeRpc(async (args) => {
      if (args.functionName === "getGuardianConfig") return [[GUARDIAN], 1, 86400, 43200] as never;
      if (args.functionName === "getPendingRecovery") return [ZERO, 0n, 0, 0] as never;
      throw new Error(`unexpected: ${args.functionName}`);
    });
    const { result } = renderHook(() => useGuardians(rpc), { wrapper: wrapperFor(makeFakeClient(true)) });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.guardians).toEqual({ addresses: [GUARDIAN], threshold: 1 });
    expect(result.current.pendingOp).toBeNull();
  });

  it("a pending recovery surfaces as pendingOp, not null", async () => {
    const rpc = fakeRpc(async (args) => {
      if (args.functionName === "getGuardianConfig") return [[GUARDIAN], 1, 86400, 43200] as never;
      if (args.functionName === "getPendingRecovery") return [DEVICE, 3n, 1, 12345] as never;
      throw new Error(`unexpected: ${args.functionName}`);
    });
    const { result } = renderHook(() => useGuardians(rpc), { wrapper: wrapperFor(makeFakeClient(true)) });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.pendingOp).toEqual({ promoteKey: DEVICE, readyAt: 12345 });
  });

  it("buildProposeCall/buildExecuteCall/buildVetoCall/buildSetupCall all target the wallet's own address", () => {
    const rpc = fakeRpc(async () => [] as never);
    const { result } = renderHook(() => useGuardians(rpc), { wrapper: wrapperFor(makeFakeClient(true)) });
    const op = { kind: "add" as const, guardian: GUARDIAN, newThreshold: 0, nonce: 1n };

    expect(result.current.buildProposeCall(op).to).toBe(WALLET);
    expect(result.current.buildExecuteCall(op).to).toBe(WALLET);
    expect(result.current.buildVetoCall(`0x${"00".repeat(32)}`).to).toBe(WALLET);
    expect(
      result.current.buildSetupCall({
        guardians: [GUARDIAN],
        threshold: 1,
        recoveryDelaySeconds: 86400,
        guardianOpDelaySeconds: 43200,
      }).to,
    ).toBe(WALLET);
  });
});
