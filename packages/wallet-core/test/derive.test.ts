import { describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { deriveSolanaKey, evmAddress, solanaAddressFromSecret } from "../src/crypto/derive.js";

const ENTROPY = "0x00000000000000000000000000000000";
const EVM_ADDR = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const EVM_KEY = "0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727";
const SOL_SEED = "0x37df573b3ac4ad5b522e064e25b63ea16bcbe79d449e81a0268d1047948bb445";
const SOL_ADDR = "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk";

describe("derive", () => {
  it("derives the EVM address from a private key", () => {
    expect(evmAddress(hexToBytes(EVM_KEY))).toBe(EVM_ADDR);
  });

  it("derives the Solana ed25519 key/address via SLIP-0010 (Phantom-compatible)", () => {
    const { secretKey } = deriveSolanaKey(hexToBytes(ENTROPY));
    expect(`0x${Buffer.from(secretKey).toString("hex")}`).toBe(SOL_SEED);
    expect(solanaAddressFromSecret(hexToBytes(SOL_SEED))).toBe(SOL_ADDR);
  });
});
