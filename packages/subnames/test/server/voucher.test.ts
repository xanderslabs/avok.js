import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { buildVoucher } from "../../src/server/index.js";
import { recoverVoucherSigner, voucherDomain } from "../../src/index.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const REGISTRAR = "0x1111111111111111111111111111111111111111" as const;
const OWNER = "0x2222222222222222222222222222222222222222" as const;

describe("subnames/server buildVoucher", () => {
  it("signs a voucher the registrar builder can recover", async () => {
    // WHY: the signer and the mint builder are now in DIFFERENT halves of the package.
    // If their EIP-712 domains ever drift, every mint reverts on-chain with a bad signature.
    const v = await buildVoucher({ voucherKey: KEY, registrar: REGISTRAR, chainId: 1, label: "alice", owner: OWNER });
    const signer = await recoverVoucherSigner(
      { label: "alice", owner: OWNER, expiry: v.expiry },
      voucherDomain(1, REGISTRAR),
      v.signature,
    );
    expect(signer.toLowerCase()).toBe(privateKeyToAccount(KEY).address.toLowerCase());
  });

  it("ENS-normalizes the label before signing", async () => {
    // WHY: the mint builder normalizes too. If the signer did not, a voucher for "Alice"
    // would sign a label the builder never mints — a silent, on-chain-only failure.
    const v = await buildVoucher({ voucherKey: KEY, registrar: REGISTRAR, chainId: 1, label: "Alice", owner: OWNER });
    const signer = await recoverVoucherSigner(
      { label: "alice", owner: OWNER, expiry: v.expiry },
      voucherDomain(1, REGISTRAR),
      v.signature,
    );
    expect(signer.toLowerCase()).toBe(privateKeyToAccount(KEY).address.toLowerCase());
  });

  it("checksums the owner and sets a default 1h expiry", async () => {
    const before = BigInt(Math.floor(Date.now() / 1000));
    const v = await buildVoucher({ voucherKey: KEY, registrar: REGISTRAR, chainId: 1, label: "alice", owner: OWNER });
    expect(v.expiry).toBeGreaterThan(before);
    expect(v.expiry).toBeLessThanOrEqual(before + 3601n);
  });
});
