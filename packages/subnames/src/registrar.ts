import { bytesToHex, encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { base58 } from "@scure/base";
import { getEnsDeployment } from "@avokjs/contracts";
import { normalizeSubname } from "@avokjs/helpers";
import type { Voucher } from "./voucher.js";

export type Call = { to: Address; value: bigint; data: Hex };

export interface RegistrarCallBuilder {
  buildMintCall(args: { voucher: Voucher; signature: Hex }): Call;
}

const VOUCHER_REGISTRAR_ABI = [
  {
    type: "function",
    name: "registerWithVoucher",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "expiry", type: "uint64" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const OPEN_CLAIM_ABI = [
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "label", type: "string" }], outputs: [] },
] as const;

const REVERSE_REGISTRAR_ABI = [
  { type: "function", name: "setName", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }], outputs: [{ type: "bytes32" }] },
] as const;

/** Vouchered mint: registerWithVoucher(label, owner, expiry, signature) — the default gate. */
export function createVoucherRegistrarCallBuilder(registrar: Address): RegistrarCallBuilder {
  return {
    buildMintCall({ voucher, signature }) {
      return {
        to: registrar,
        value: 0n,
        data: encodeFunctionData({
          abi: VOUCHER_REGISTRAR_ABI,
          functionName: "registerWithVoucher",
          args: [normalizeSubname(voucher.label), voucher.owner, voucher.expiry, signature],
        }),
      };
    },
  };
}

/** Open-claim mint: claim(label) — first-come, no voucher (opt-in registrar mode). */
export function createOpenClaimRegistrarCallBuilder(registrar: Address): { buildMintCall(a: { label: string }): Call } {
  return {
    buildMintCall({ label }) {
      return {
        to: registrar,
        value: 0n,
        data: encodeFunctionData({ abi: OPEN_CLAIM_ABI, functionName: "claim", args: [normalizeSubname(label)] }),
      };
    },
  };
}

export const SOLANA_COIN_TYPE = 501n; // SLIP-44 coin type for Solana (ENSIP-9 multicoin addr record).

const MULTICOIN_RESOLVER_ABI = [
  {
    type: "function",
    name: "setAddr",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "coinType", type: "uint256" },
      { name: "a", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/**
 * Write the wallet's Solana address as an ENSIP-9 coinType-501 record, so one ENS subname
 * forward-resolves to BOTH chains. Appended to the mint batch; the user's wallet (which owns the
 * node after mint) is the authorized caller.
 */
export function buildSetSolanaAddrCall(resolver: Address, node: Hex, solanaAddress: string): Call {
  const bytes = base58.decode(solanaAddress);
  if (bytes.length !== 32) throw new Error("buildSetSolanaAddrCall: solana address must decode to 32 bytes");
  return {
    to: resolver,
    value: 0n,
    data: encodeFunctionData({
      abi: MULTICOIN_RESOLVER_ABI,
      functionName: "setAddr",
      args: [node, SOLANA_COIN_TYPE, bytesToHex(bytes)],
    }),
  };
}

/** Set the wallet's ENS primary (reverse) name on the given chain (ENSIP-19 L1 primary). */
export function buildSetPrimaryNameCall(chainId: number, name: string): Call {
  const reverseRegistrar = getAddress(getEnsDeployment(chainId).reverseRegistrar);
  return {
    to: reverseRegistrar,
    value: 0n,
    data: encodeFunctionData({ abi: REVERSE_REGISTRAR_ABI, functionName: "setName", args: [name] }),
  };
}
