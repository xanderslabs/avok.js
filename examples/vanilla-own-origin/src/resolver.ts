/**
 * The app's name resolver.
 *
 * Resolution is not part of the core client: it is a plain helper the APP constructs. That is the
 * point — name RESOLUTION stands alone from any registration (which Avok does not do). The app
 * resolves `vitalik.eth` / `toly.sol` with no registrar, contract, or backend involved.
 *
 * ENS always resolves on Ethereum L1 mainnet and SNS on Solana mainnet, regardless of the chain the
 * wallet is transacting on. Built once at module scope and used by Send.
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
