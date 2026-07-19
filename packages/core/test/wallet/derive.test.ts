import { describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { deriveSolanaKey, evmAddress, solanaAddressFromSecret } from "../../src/wallet/crypto/derive.js";

const K = "0x00000000000000000000000000000000";
const EVM_ADDR = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const EVM_KEY = "0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727";
// The Solana ed25519 seed = HKDF-SHA256(K, salt=HKDF_SALT, info=SOLANA_KEY_INFO). Pinned so any other
// implementation must reproduce these exact bytes to reach the same Solana address. This is NOT a
// SLIP-0010/BIP-44 path and is deliberately not Phantom's seed-derivation — K is never a user mnemonic,
// so that path was never reachable; the only user interop is the raw exported key, which any wallet
// (Phantom included) imports regardless of how it was derived. See crypto/derive-wallet.ts SOLANA_KEY_INFO.
const SOL_SEED = "0xd53033d26dcca9b3727473d26085be58f6d5df5ca36553963b3150b97275c9c4";
const SOL_ADDR = "HLjrg2pVuUpujgWQfd9saCRdZVxt3DsZ8RRiABjQH1mW";

describe("derive", () => {
  it("derives the EVM address from a private key", () => {
    expect(evmAddress(hexToBytes(EVM_KEY))).toBe(EVM_ADDR);
  });

  it("derives the Solana ed25519 key/address from K via HKDF (deterministic, no mnemonic string)", () => {
    const { secretKey } = deriveSolanaKey(hexToBytes(K));
    expect(`0x${Buffer.from(secretKey).toString("hex")}`).toBe(SOL_SEED);
    expect(solanaAddressFromSecret(hexToBytes(SOL_SEED))).toBe(SOL_ADDR);
  });
});
