import { describe, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { voucherDomain, signVoucher, recoverVoucherSigner, type Voucher } from "../src/voucher.js";

const REGISTRAR = getAddress("0x00000000000000000000000000000000000000aa");
const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const OWNER = getAddress("0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c");

describe("subname EIP-712 voucher", () => {
  test("recoverVoucherSigner recovers the operator signer from a signed voucher", async () => {
    const domain = voucherDomain(1, REGISTRAR);
    const v: Voucher = { label: "alice", owner: OWNER, expiry: 9999999999n };
    const sig = await signVoucher(v, domain, signer);
    expect(await recoverVoucherSigner(v, domain, sig)).toBe(signer.address);
  });

  test("a tampered label breaks recovery", async () => {
    const domain = voucherDomain(1, REGISTRAR);
    const v: Voucher = { label: "alice", owner: OWNER, expiry: 9999999999n };
    const sig = await signVoucher(v, domain, signer);
    const recovered = await recoverVoucherSigner({ ...v, label: "bob" }, domain, sig);
    expect(recovered).not.toBe(signer.address);
  });
});
