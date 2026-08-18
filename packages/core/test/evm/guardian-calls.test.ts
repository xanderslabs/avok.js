import { describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, encodeAbiParameters, type Address, type Hex } from "viem";
import { GuardianLogicABI } from "@avokjs/contracts";
import {
  buildExecuteGuardianOpCall,
  buildProposeGuardianOpCall,
  buildSetupGuardiansCall,
  buildVetoGuardianOpCall,
  type GuardianOp,
} from "../../src/evm/guardian-calls.js";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const GUARDIAN = "0x2222222222222222222222222222222222222222" as Address;

describe("buildSetupGuardiansCall", () => {
  it("targets the wallet and encodes the exact setupGuardians signature", () => {
    const call = buildSetupGuardiansCall({
      wallet: WALLET,
      guardians: [GUARDIAN],
      threshold: 1,
      recoveryDelaySeconds: 86400,
      guardianOpDelaySeconds: 43200,
    });
    expect(call.to).toBe(WALLET);
    const decoded = decodeFunctionData({ abi: GuardianLogicABI, data: call.data });
    expect(decoded.functionName).toBe("setupGuardians");
    expect(decoded.args).toEqual([[GUARDIAN], 1, 86400, 43200]);
  });
});

describe("guardian op calls", () => {
  const op: GuardianOp = { kind: "add", guardian: GUARDIAN, newThreshold: 0, nonce: 5n };

  it("propose encodes OpKind.Add as 0", () => {
    const call = buildProposeGuardianOpCall(WALLET, op);
    const decoded = decodeFunctionData({ abi: GuardianLogicABI, data: call.data });
    expect(decoded.functionName).toBe("proposeGuardianOp");
    const [decodedOp] = decoded.args as [{ kind: number; guardian: Address; newThreshold: number; nonce: bigint }];
    expect(decodedOp.kind).toBe(0);
    expect(decodedOp.guardian).toBe(GUARDIAN);
    expect(decodedOp.nonce).toBe(5n);
  });

  it("kind mapping: remove=1, setThreshold=2", () => {
    const remove = buildProposeGuardianOpCall(WALLET, { ...op, kind: "remove" });
    const setThreshold = buildProposeGuardianOpCall(WALLET, { ...op, kind: "setThreshold", newThreshold: 3 });
    const removeDecoded = decodeFunctionData({ abi: GuardianLogicABI, data: remove.data });
    const thresholdDecoded = decodeFunctionData({ abi: GuardianLogicABI, data: setThreshold.data });
    expect((removeDecoded.args as unknown as [{ kind: number }])[0].kind).toBe(1);
    const [decodedOp] = thresholdDecoded.args as unknown as [{ kind: number; newThreshold: number }];
    expect(decodedOp.kind).toBe(2);
    expect(decodedOp.newThreshold).toBe(3);
  });

  it("execute encodes the same op shape as propose — same bytes make the same opHash", () => {
    const proposed = buildProposeGuardianOpCall(WALLET, op);
    const executed = buildExecuteGuardianOpCall(WALLET, op);
    const proposedDecoded = decodeFunctionData({ abi: GuardianLogicABI, data: proposed.data });
    const executedDecoded = decodeFunctionData({ abi: GuardianLogicABI, data: executed.data });
    expect(executedDecoded.args).toEqual(proposedDecoded.args);
  });

  it("veto encodes the raw opHash unchanged", () => {
    const opHash = keccak256(encodeAbiParameters([{ type: "uint8" }], [0])) as Hex;
    const call = buildVetoGuardianOpCall(WALLET, opHash);
    const decoded = decodeFunctionData({ abi: GuardianLogicABI, data: call.data });
    expect(decoded.functionName).toBe("vetoGuardianOp");
    expect((decoded.args as [Hex])[0]).toBe(opHash);
  });

  it("every guardian-op call targets the wallet's own address (the self-call pattern)", () => {
    for (const call of [
      buildProposeGuardianOpCall(WALLET, op),
      buildExecuteGuardianOpCall(WALLET, op),
      buildVetoGuardianOpCall(WALLET, `0x${"00".repeat(32)}` as Hex),
    ]) {
      expect(call.to).toBe(WALLET);
      expect(call.value).toBe(0n);
    }
  });
});
