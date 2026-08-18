import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodePacked,
  hashTypedData,
  keccak256,
  recoverAddress,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  approveAsConnectedGuardian,
  approveWithImportedKey,
  recoveryApprovalTypedData,
} from "../../../src/vault/recover/approve.js";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const PROMOTE_KEY = "0x2222222222222222222222222222222222222222" as Address;
const NONCE = 3n;
const CHAIN_ID = 10;

/** Manually reproduces GuardianLogic.sol's `_recoveryApprovalDigest` byte-for-byte — independent of
 *  `recoveryApprovalTypedData`/viem's `hashTypedData` internals, so this test is not just calling the
 *  code under test a second time (same pattern as evm/roster-signature.test.ts's referenceKeyHash). */
function referenceDigest(wallet: Address, promoteKey: Address, nonce: bigint, chainId: number): Hex {
  const domainTypehash = keccak256(
    toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
  );
  const nameHash = keccak256(toBytes("Avok Guardians"));
  const versionHash = keccak256(toBytes("1"));
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [domainTypehash, nameHash, versionHash, BigInt(chainId), wallet],
    ),
  );
  const approvalTypehash = keccak256(toBytes("RecoveryApproval(address promoteKey,uint64 nonce)"));
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint64" }],
      [approvalTypehash, promoteKey, nonce],
    ),
  );
  return keccak256(encodePacked(["bytes2", "bytes32", "bytes32"], ["0x1901", domainSeparator, structHash]));
}

describe("recoveryApprovalTypedData", () => {
  it("hashes to exactly what GuardianLogic.sol's _recoveryApprovalDigest computes", () => {
    const typedData = recoveryApprovalTypedData({
      wallet: WALLET,
      chainId: CHAIN_ID,
      promoteKey: PROMOTE_KEY,
      nonce: NONCE,
    });
    expect(hashTypedData(typedData)).toBe(referenceDigest(WALLET, PROMOTE_KEY, NONCE, CHAIN_ID));
  });

  it("changes with the wallet (verifyingContract) — a signature for one wallet cannot cross to another", () => {
    const a = hashTypedData(
      recoveryApprovalTypedData({ wallet: WALLET, chainId: CHAIN_ID, promoteKey: PROMOTE_KEY, nonce: NONCE }),
    );
    const otherWallet = "0x3333333333333333333333333333333333333333" as Address;
    const b = hashTypedData(
      recoveryApprovalTypedData({ wallet: otherWallet, chainId: CHAIN_ID, promoteKey: PROMOTE_KEY, nonce: NONCE }),
    );
    expect(a).not.toBe(b);
  });
});

describe("approveWithImportedKey", () => {
  const PRIVATE_KEY = `0x${"11".repeat(32)}` as Hex;
  const account = privateKeyToAccount(PRIVATE_KEY);

  it("the resulting signature recovers to the imported key's own address (that becomes `guardian`)", async () => {
    const approval = await approveWithImportedKey({
      privateKey: PRIVATE_KEY,
      wallet: WALLET,
      chainId: CHAIN_ID,
      promoteKey: PROMOTE_KEY,
      nonce: NONCE,
    });

    expect(approval.guardian.toLowerCase()).toBe(account.address.toLowerCase());
    const digest = hashTypedData(
      recoveryApprovalTypedData({ wallet: WALLET, chainId: CHAIN_ID, promoteKey: PROMOTE_KEY, nonce: NONCE }),
    );
    const recovered = await recoverAddress({ hash: digest, signature: approval.signature });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("promoteKey and nonce pass through unchanged", async () => {
    const approval = await approveWithImportedKey({
      privateKey: PRIVATE_KEY,
      wallet: WALLET,
      chainId: CHAIN_ID,
      promoteKey: PROMOTE_KEY,
      nonce: NONCE,
    });
    expect(approval.promoteKey).toBe(PROMOTE_KEY);
    expect(approval.nonce).toBe(NONCE);
  });
});

describe("approveAsConnectedGuardian", () => {
  it("delegates signing to the injected signTypedData and returns the same envelope shape", async () => {
    const guardian = "0x4444444444444444444444444444444444444444" as Address;
    const signTypedData = async (_typedData: unknown) => "0xdeadbeef" as Hex;

    const approval = await approveAsConnectedGuardian({
      guardian,
      wallet: WALLET,
      chainId: CHAIN_ID,
      promoteKey: PROMOTE_KEY,
      nonce: NONCE,
      signTypedData,
    });

    expect(approval).toEqual({ guardian, promoteKey: PROMOTE_KEY, nonce: NONCE, signature: "0xdeadbeef" });
  });

  it("signs the SAME typed data a connected wallet's eth_signTypedData_v4 would show the user", async () => {
    let captured: unknown;
    const signTypedData = async (typedData: unknown) => {
      captured = typedData;
      return "0x00" as Hex;
    };
    await approveAsConnectedGuardian({
      guardian: "0x4444444444444444444444444444444444444444",
      wallet: WALLET,
      chainId: CHAIN_ID,
      promoteKey: PROMOTE_KEY,
      nonce: NONCE,
      signTypedData,
    });
    expect(captured).toEqual(
      recoveryApprovalTypedData({ wallet: WALLET, chainId: CHAIN_ID, promoteKey: PROMOTE_KEY, nonce: NONCE }),
    );
  });
});
