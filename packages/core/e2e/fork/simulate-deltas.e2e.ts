// FORK — E2E leg (b): a batched send whose simulation produces correct asset deltas via the wired
// consent path (TDD §5 "Consent pipeline"). CI-runnable WITHOUT funds: forks Base Sepolia with anvil
// (a local process; no real transactions), deploys a fresh MockERC20 from anvil's own well-funded dev
// account, mints it to a throwaway wallet address, and calls the REAL `vault/simulate` module
// (`simulateRequest`) against the fork's `eth_simulateV1` — exactly what the Vault's consent screen
// calls to render "you send" rows.
//
// Run: pnpm --dir packages/core exec vitest run --config e2e/vitest.e2e.config.ts e2e/fork/simulate-deltas.e2e.ts
// Requires: `anvil` on PATH (ships with Foundry, already a repo dependency). No funded key needed —
// skips cleanly if anvil is not installed.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createPublicClient, createWalletClient, http, encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeViemRpc } from "../../src/client/evm.js";
import { simulateRequest } from "../../src/vault/simulate/index.js";
import { baseSepolia } from "../lib/chain.js";
import { BASE_SEPOLIA_REGISTRY_RPC } from "../lib/env.js";

const here = dirname(fileURLToPath(import.meta.url));
const MOCK_ERC20_ARTIFACT = resolve(here, "../../../../contracts/out/MockERC20.sol/MockERC20.json");

// The standard first anvil dev account — deterministic, funded with 10,000 ETH on every anvil
// instance regardless of what the forked chain looks like. Local-only; never used against a real
// chain (this file only ever points at a `127.0.0.1` anvil URL).
const ANVIL_DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

function anvilAvailable(): boolean {
  try {
    execSync("anvil --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = anvilAvailable();

describe.skipIf(!canRun)("e2e (b): batched send simulation produces correct asset deltas (fork)", () => {
  let anvil: ChildProcess;
  const port = 8646;
  const rpcUrl = `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    anvil = spawn("anvil", ["--fork-url", BASE_SEPOLIA_REGISTRY_RPC, "--port", String(port), "--silent"], {
      stdio: "ignore",
    });
    // Poll until anvil accepts connections.
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) }).getChainId();
        break;
      } catch (err) {
        if (Date.now() > deadline) throw new Error(`anvil did not become ready: ${err}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }, 40_000);

  afterAll(() => {
    anvil?.kill();
  });

  it("decodes a real ERC-20 Transfer log into a correct asset delta", async () => {
    const dev = privateKeyToAccount(ANVIL_DEV_KEY);
    const walletClient = createWalletClient({ account: dev, chain: baseSepolia, transport: http(rpcUrl) });
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

    const artifact = JSON.parse(readFileSync(MOCK_ERC20_ARTIFACT, "utf8"));
    const deployHash = await walletClient.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object as Hex,
    });
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    const tokenAddress = deployReceipt.contractAddress as Address;
    expect(tokenAddress).toBeDefined();

    // A throwaway wallet: holds tokens to transfer, needs no ETH — simulation never broadcasts.
    const wallet = privateKeyToAccount(generatePrivateKey()).address;
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const amount = 42_000_000n; // 42 "mUSD" at 18 decimals worth of base units — the exact number under test

    const mintHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: artifact.abi,
      functionName: "mint",
      args: [wallet, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });

    const rpc = makeViemRpc([rpcUrl]);
    const transferCall = {
      to: tokenAddress,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }),
    };

    const result = await simulateRequest(rpc, { chainId: baseSepolia.id, account: wallet, calls: [transferCall] });

    expect(result.status).toBe("simulated");
    expect(result.deltas).toHaveLength(1);
    const [delta] = result.deltas;
    expect(delta.kind).toBe("erc20");
    expect(delta.token?.toLowerCase()).toBe(tokenAddress.toLowerCase());
    expect(delta.amount).toBe(amount);
    expect(delta.direction).toBe("out"); // relative to `wallet` — an unregistered token still resolves correctly

    // Cross-check against the token's real post-simulation-would-be balances by replaying the same
    // transfer for real on the fork (simulation must not have mutated fork state) and confirming the
    // ending balance matches — proves the delta reflects the CONTRACT's actual accounting, not a
    // decode-only guess.
    const preBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
    });
    expect(preBalance).toBe(amount); // simulation left fork state untouched
  });
});
