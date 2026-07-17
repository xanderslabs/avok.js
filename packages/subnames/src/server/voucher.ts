import { privateKeyToAccount } from "viem/accounts";
import { getAddress, type Address, type Hex } from "viem";
import { normalizeSubname } from "@avokjs/helpers";
import { signVoucher, voucherDomain } from "../index.js";

/**
 * Operator voucher signer. The operator's backend authenticates the user, then signs an EIP-712
 * voucher binding {label, owner, expiry} with its voucher key. The label is ENS-normalized so it
 * matches exactly what the client mints (the `buildSubnameMintCalls` builder normalizes too).
 *
 * ⚠️ PRODUCTION HARDENING — NOW MANDATORY, NOT OPTIONAL. This function signs for whatever `owner`
 * you pass it. You MUST gate it on proof that the caller controls `owner` (a wallet PoP such as a
 * SIWE signature over a single-use challenge, or an authenticated session). #6 deleted the reference
 * route that did this (the auth origin's `POST /subname/voucher`, which recovered `owner` from a SIWE
 * PoP rather than trusting the request body), so there is no longer a built-in gate behind you.
 * Without one, any caller can mint a name to any address.
 */
export async function buildVoucher(args: {
  voucherKey: Hex;
  registrar: Address;
  chainId: number;
  label: string;
  owner: Address;
  ttlSeconds?: number;
}): Promise<{ owner: Address; expiry: bigint; signature: Hex }> {
  const label = normalizeSubname(args.label);
  const owner = getAddress(args.owner);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + (args.ttlSeconds ?? 3600));
  const account = privateKeyToAccount(args.voucherKey);
  const signature = await signVoucher({ label, owner, expiry }, voucherDomain(args.chainId, args.registrar), account);
  return { owner, expiry, signature };
}
