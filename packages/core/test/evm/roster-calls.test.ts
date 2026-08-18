import { describe, expect, it } from "vitest";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { AvokCaliburABI } from "@avokjs/contracts";
import { buildRegisterDeviceCall, buildRevokeDeviceCall, deviceKeyHash } from "../../src/evm/roster-calls.js";
import { computeSecp256k1KeyHash } from "../../src/evm/roster-signature.js";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const DEVICE = "0x2222222222222222222222222222222222222222" as Address;

describe("buildRegisterDeviceCall", () => {
  it("targets the wallet's own address — the self-call the execute() batch must land on", () => {
    const call = buildRegisterDeviceCall(WALLET, DEVICE);
    expect(call.to).toBe(WALLET);
    expect(call.value).toBe(0n);
  });

  it("encodes register(Key) with keyType=Secp256k1 and the device's address as the public key", () => {
    const call = buildRegisterDeviceCall(WALLET, DEVICE);
    const decoded = decodeFunctionData({ abi: AvokCaliburABI, data: call.data });
    expect(decoded.functionName).toBe("register");
    const [key] = decoded.args as [{ keyType: number; publicKey: Hex }];
    expect(key.keyType).toBe(2);
    expect(key.publicKey.toLowerCase()).toBe(DEVICE.toLowerCase());
  });
});

describe("buildRevokeDeviceCall", () => {
  it("targets the wallet and encodes revoke(keyHash)", () => {
    const keyHash = deviceKeyHash(DEVICE);
    const call = buildRevokeDeviceCall(WALLET, keyHash);
    expect(call.to).toBe(WALLET);
    const decoded = decodeFunctionData({ abi: AvokCaliburABI, data: call.data });
    expect(decoded.functionName).toBe("revoke");
    expect((decoded.args as [Hex])[0]).toBe(keyHash);
  });
});

describe("deviceKeyHash", () => {
  it("is the same computation evm/roster-signature.ts's wrapper uses for signing", () => {
    expect(deviceKeyHash(DEVICE)).toBe(computeSecp256k1KeyHash(DEVICE));
  });
});
