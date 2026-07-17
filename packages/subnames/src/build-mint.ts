import type { Address, Hex } from "viem";
import { fullName, normalizeSubname, type EnsClient } from "@avokjs/helpers";
import { createEnsRegistrar } from "./ens-registrar.js";
import { createOpenClaimRegistrarCallBuilder, type Call } from "./registrar.js";
import { readMintFee, buildApproveFeeCall, type FeeReaderClient } from "./fee.js";
import { createSnsRegistrar, type SnsRpc } from "./sns/index.js";

/** ENS subnames ALWAYS mint on Ethereum L1 mainnet, whatever chain the app is on. */
export const ENS_SUBNAME_CHAIN_ID = 1;
/** SNS subnames ALWAYS mint on Solana mainnet. */
export const SNS_SUBNAME_CLUSTER = "solana-mainnet";

/**
 * Build the full ENS subname mint batch. BUILD-ONLY: this returns calls and never sends them —
 * hand them to the standard wallet surface (`wallet_sendCalls`). That is why this package can be
 * optional: it needs no send seam from the core.
 *
 * The batch is ordered [approve?, mint, setPrimary] and the order is load-bearing:
 *   1. approve — only when the registrar's price > 0; it PULLS the fee during mint, so the
 *      approve must land first IN THE SAME BATCH. (This is the subname fee, NOT the gas fee
 *      token — independent concerns.)
 *   2. mint — vouchered (default) or open-claim when `voucher` is omitted.
 *      With `solanaAddress`, an ENSIP-9 coinType-501 record is appended so ONE name
 *      forward-resolves to BOTH chains.
 *   3. setPrimary — ENSIP-19 L1 primary name, so reverse resolution works where the wallet transacts.
 */
export async function buildSubnameMintCalls(args: {
  label: string;
  owner: Address;
  parent: string;
  registrar: Address;
  client: EnsClient & FeeReaderClient;
  solanaAddress?: string;
  voucher?: { owner: Address; expiry: bigint; signature: Hex };
}): Promise<{ name: string; calls: Call[] }> {
  const label = normalizeSubname(args.label);
  const name = fullName(label, args.parent);
  const svc = createEnsRegistrar({
    chainId: ENS_SUBNAME_CHAIN_ID,
    parent: args.parent,
    registrar: args.registrar,
    client: args.client,
  });

  const calls: Call[] = [];

  const fee = await readMintFee({ client: args.client, registrar: args.registrar });
  if (fee.price > 0n) calls.push(buildApproveFeeCall(fee.token, args.registrar, fee.price));

  const mint = args.voucher
    ? svc.buildMint({
        label,
        owner: args.owner,
        solanaAddress: args.solanaAddress,
        voucher: { label, owner: args.voucher.owner, expiry: args.voucher.expiry },
        signature: args.voucher.signature,
      })
    : {
        chain: "evm" as const,
        calls: [createOpenClaimRegistrarCallBuilder(args.registrar).buildMintCall({ label })],
      };
  if (mint.chain !== "evm") throw new Error("expected an EVM mint for an ENS subname");
  calls.push(...mint.calls);

  const setPrimary = svc.buildSetPrimary({ name, chainId: ENS_SUBNAME_CHAIN_ID });
  if (setPrimary.chain !== "evm") throw new Error("expected an EVM set-primary call");
  calls.push(...setPrimary.calls);

  return { name, calls };
}

/**
 * Build the SNS (.sol) subname mint instructions. BUILD-ONLY — send them via the Solana Wallet
 * Standard. Non-custodial: the buyer is the user's own wallet.
 */
export async function buildSnsMintIx(args: {
  label: string;
  owner: string;
  parent: string;
  registrar: string;
  rpc: SnsRpc;
  buildRegister: Parameters<typeof createSnsRegistrar>[0]["buildRegister"];
}): Promise<{ name: string; instructions: unknown[] }> {
  const svc = createSnsRegistrar({
    rpc: args.rpc,
    parent: args.parent,
    registrar: args.registrar,
    buildRegister: args.buildRegister,
  });
  const mint = await svc.buildMintAsync({ label: args.label, owner: args.owner });
  if (mint.chain !== "solana") throw new Error("expected a Solana mint for an SNS subname");
  return { name: `${normalizeSubname(args.label)}.${args.parent}`, instructions: mint.instructions };
}
