import { describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { evmAddress } from "../../src/wallet/crypto/derive.js";

const EVM_ADDR = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const EVM_KEY = "0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727";

describe("derive", () => {
  it("derives the EVM address from a private key", () => {
    expect(evmAddress(hexToBytes(EVM_KEY))).toBe(EVM_ADDR);
  });
});
