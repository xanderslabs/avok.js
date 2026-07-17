/**
 * The app's name resolver.
 *
 * #6 spun the subname surface out of the core client: resolution is no longer `client.subname.*`,
 * it is a plain helper the APP constructs. That is the point — an app that never mints a subname
 * still resolves `vitalik.eth` / `toly.sol`, with the @avokjs/subnames add-on uninstalled.
 *
 * ENS always resolves on Ethereum L1 mainnet and SNS on Solana mainnet, regardless of the chain the
 * wallet is transacting on. Built once at module scope and shared by Send + Subname.
 */
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { createSolanaRpc } from "@solana/kit";
import { evmRpcUrl, solanaRpcUrl } from "@avokjs/contracts";
import { createNameResolver, createEnsResolver, createSnsResolver, type EnsClient } from "@avokjs/helpers";
import { config } from "./config.js";

/** ENS subnames ALWAYS mint/resolve on Ethereum L1 mainnet. */
export const ENS_CHAIN_ID = 1;
/** SNS subnames ALWAYS mint/resolve on Solana mainnet. */
export const SNS_CLUSTER = "mainnet" as const;

/**
 * A viem PublicClient satisfies the EnsClient seam helpers' reader needs. Annotated as EnsClient
 * rather than left inferred: viem's full PublicClient type is not portable across package
 * boundaries (TS2883), and EnsClient is the only surface any of this actually uses.
 */
export const ensPublicClient: EnsClient = createPublicClient({
  chain: mainnet,
  transport: http(evmRpcUrl(ENS_CHAIN_ID, config.rpcUrls)),
}) as unknown as EnsClient;

export const resolver = createNameResolver({
  ens: createEnsResolver({ chainId: ENS_CHAIN_ID, client: ensPublicClient }),
  sns: createSnsResolver({ rpc: createSolanaRpc(solanaRpcUrl(SNS_CLUSTER, config.rpcUrls)) }),
});
