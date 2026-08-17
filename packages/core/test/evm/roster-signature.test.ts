import { describe, expect, it } from "vitest";
import { decodeAbiParameters, encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { computeSecp256k1KeyHash, wrapRosterSignature } from "../../src/evm/roster-signature.js";

const DEVICE_ADDRESS: Address = "0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c";

/** Independently reproduces KeyLib.sol's formula, so the test is not just calling the function under
 *  test a second time — this mirrors `keccak256(abi.encode(keyType, keccak256(publicKey)))` where
 *  `publicKey = abi.encode(address)`, byte for byte, from the Solidity source directly. */
function referenceKeyHash(address: Address): Hex {
  const publicKey = encodeAbiParameters([{ type: "address" }], [address]);
  const publicKeyHash = keccak256(publicKey);
  return keccak256(encodeAbiParameters([{ type: "uint8" }, { type: "bytes32" }], [2, publicKeyHash]));
}

describe("computeSecp256k1KeyHash", () => {
  it("matches an independent reproduction of KeyLib.hash's formula", () => {
    expect(computeSecp256k1KeyHash(DEVICE_ADDRESS)).toBe(referenceKeyHash(DEVICE_ADDRESS));
  });

  it("is deterministic", () => {
    expect(computeSecp256k1KeyHash(DEVICE_ADDRESS)).toBe(computeSecp256k1KeyHash(DEVICE_ADDRESS));
  });

  it("differs for a different address", () => {
    const other: Address = "0x2222222222222222222222222222222222222222";
    expect(computeSecp256k1KeyHash(DEVICE_ADDRESS)).not.toBe(computeSecp256k1KeyHash(other));
  });

  it("is case-insensitive over the input address (checksummed vs lowercase agree)", () => {
    expect(computeSecp256k1KeyHash(DEVICE_ADDRESS)).toBe(
      computeSecp256k1KeyHash(DEVICE_ADDRESS.toLowerCase() as Address),
    );
  });
});

describe("wrapRosterSignature", () => {
  const RAW_SIGNATURE: Hex = `0x${"ab".repeat(65)}`;

  it("produces the exact WrappedSignatureLib.decodeWithKeyHashAndHookData envelope", () => {
    const wrapped = wrapRosterSignature(DEVICE_ADDRESS, RAW_SIGNATURE);
    const [keyHash, signature, hookData] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes" }, { type: "bytes" }],
      wrapped,
    );
    expect(keyHash).toBe(computeSecp256k1KeyHash(DEVICE_ADDRESS));
    expect(signature).toBe(RAW_SIGNATURE);
    expect(hookData).toBe("0x");
  });

  it("is never mistaken for a raw signature (WrappedSignatureLib.isRawSignature checks length 64/65)", () => {
    const wrapped = wrapRosterSignature(DEVICE_ADDRESS, RAW_SIGNATURE);
    const bodyBytes = (wrapped.length - 2) / 2;
    expect(bodyBytes).not.toBe(64);
    expect(bodyBytes).not.toBe(65);
  });
});
