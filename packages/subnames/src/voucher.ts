import { recoverTypedDataAddress, type Address, type Hex, type TypedDataDomain } from "viem";

export type Voucher = { label: string; owner: Address; expiry: bigint };

export const VOUCHER_TYPES = {
  Voucher: [
    { name: "label", type: "string" },
    { name: "owner", type: "address" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export function voucherDomain(chainId: number, registrar: Address): TypedDataDomain {
  return { name: "AvokSubnameRegistrar", version: "1", chainId, verifyingContract: registrar };
}

/** Operator-side helper (also used in tests/DX): sign a voucher with the operator key. */
export async function signVoucher(
  voucher: Voucher,
  domain: TypedDataDomain,
  account: {
    signTypedData: (a: {
      domain: TypedDataDomain;
      types: typeof VOUCHER_TYPES;
      primaryType: "Voucher";
      message: Voucher;
    }) => Promise<Hex>;
  },
): Promise<Hex> {
  return account.signTypedData({ domain, types: VOUCHER_TYPES, primaryType: "Voucher", message: voucher });
}

export function recoverVoucherSigner(voucher: Voucher, domain: TypedDataDomain, signature: Hex): Promise<Address> {
  return recoverTypedDataAddress({ domain, types: VOUCHER_TYPES, primaryType: "Voucher", message: voucher, signature });
}
