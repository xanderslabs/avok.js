/**
 * The app's name resolver.
 *
 * Resolution is not part of the core client: it is a plain helper the APP constructs. This app only
 * RESOLVES names — nothing in Avok mints them — so it needs the resolver and no registration code
 * at all. That separation is the point.
 *
 * ENS always resolves on Ethereum L1 mainnet and SNS on Solana mainnet, regardless of the chain the
 * wallet is transacting on.
 */
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { createSolanaRpc } from "@solana/kit";
import { evmRpcUrl, solanaRpcUrl } from "@avokjs/contracts";
import { createNameResolver, createEnsResolver, createSnsResolver, type EnsClient } from "@avokjs/core/helpers";
import { config } from "./config.js";

const ENS_CHAIN_ID = 1;
const SNS_CLUSTER = "mainnet" as const;

/**
 * A viem PublicClient satisfies the EnsClient seam helpers' reader needs. Annotated as EnsClient
 * rather than left inferred: viem's full PublicClient type is not portable across package
 * boundaries (TS2883), and EnsClient is the only surface any of this actually uses.
 */
const ensPublicClient: EnsClient = createPublicClient({
  chain: mainnet,
  transport: http(evmRpcUrl(ENS_CHAIN_ID, config.rpcUrls)),
}) as unknown as EnsClient;

export const resolver = createNameResolver({
  ens: createEnsResolver({ chainId: ENS_CHAIN_ID, client: ensPublicClient }),
  sns: createSnsResolver({ rpc: createSolanaRpc(solanaRpcUrl(SNS_CLUSTER, config.rpcUrls)) }),
});
