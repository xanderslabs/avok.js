import { createPublicClient, createWalletClient, http, defineChain, type Address, type Hex, type PublicClient } from "viem";
import { makeViemRpc } from "../../src/client/evm.js";
import type { RpcClient } from "../../src/evm/rpc.js";
import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_RPC, deployerAccount } from "./env.js";

export const baseSepolia = defineChain({
  id: BASE_SEPOLIA_CHAIN_ID,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [BASE_SEPOLIA_RPC] } },
  testnet: true,
});

export const publicClient: PublicClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC) });

/** Sends `amountWei` of native ETH from the funded deployer key to `to` and waits for the receipt. */
export async function fundFromDeployer(to: Address, amountWei: bigint): Promise<Hex> {
  const account = deployerAccount();
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC) });
  const hash = await walletClient.sendTransaction({ to, value: amountWei });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function waitForTx(hash: Hex) {
  return publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
}

export function explorerTx(hash: string): string {
  return `https://sepolia.basescan.org/tx/${hash}`;
}

export function explorerAddress(addr: string): string {
  return `https://sepolia.basescan.org/address/${addr}`;
}

/** The `RpcClient` port every E2E script drives the real SDK/contract calls through — the SAME
 *  `makeViemRpc` production code (`client/evm.ts`) uses to turn an RPC URL into an `RpcClient`, so
 *  these scripts exercise the exact adapter a real integrator's app would. */
export function makeRpc(): RpcClient {
  return makeViemRpc([BASE_SEPOLIA_RPC]);
}
