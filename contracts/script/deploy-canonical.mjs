#!/usr/bin/env node
// One-command maintainer CLI: deploys the canonical AvokWalletImplementation
// (via the CREATE2 deploy in DeployCanonical.s.sol) to a chain and, on success,
// writes the deterministic address into src-ts/registry.ts.
//
// FUND-CRITICAL: this address is the EIP-7702 delegation target for every Avok
// wallet on that chain. The address is the SAME on every EVM chain by CREATE2
// construction (see DeployCanonical.s.sol). This CLI refuses to write anything
// to the registry unless the deployed address matches GOLDEN exactly.
//
// Usage:
//   node script/deploy-canonical.mjs --chain base --rpc https://... --account deployer
//   node script/deploy-canonical.mjs --chain base --rpc https://... --dry-run
//   DEPLOYER_PRIVATE_KEY=0x... node script/deploy-canonical.mjs --chain base --rpc https://...
//
// Deployer key handling (SECURITY): the private key is NEVER accepted as a CLI
// argument (that would leak into shell history and the OS process list). Use
// either --account <forge keystore name> (preferred: forge decrypts it locally
// and the key never touches env or argv) or the DEPLOYER_PRIVATE_KEY env var.
// Note: DEPLOYER_PRIVATE_KEY mode passes the key to forge as --private-key, which
// is visible in forge's own process listing for the deploy's duration. --account
// avoids that entirely; prefer it on shared or untrusted machines.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getAddress } from "viem";
import { applyWriteback, addressFromBroadcast } from "./write-canonical-address.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(here, "..");

// Must match GOLDEN_CANONICAL in test/DeployCanonical.t.sol and the require() in DeployCanonical.s.sol.
// This is the CREATE2 address of the CURRENT AvokWalletImplementation bytecode under the canonical salt via
// the Arachnid deployer (0x4e59…) — verify with:
//   cast create2 --deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C \
//     --salt $(cast keccak "avok.wallet.canonical") \
//     --init-code-hash $(cast keccak $(jq -r .bytecode.object out/AvokWalletImplementation.sol/AvokWalletImplementation.json))
// It drifted once (a stale 0x579b47… survived a bytecode change while the Solidity test + registry
// moved on) and NOTHING caught it — each suite only checked its own copy. golden-drift.test.ts now
// cross-checks this constant against the Solidity literal.
export const GOLDEN = "0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C";

export const CHAIN_IDS = {
  ethereum: 1,
  optimism: 10,
  bsc: 56,
  base: 8453,
  arbitrum: 42161,
  arc: 5042002,
};

/** Resolve a --chain name to its chainId. Throws with the valid name list on a miss. */
export function resolveChainId(chain) {
  const chainId = CHAIN_IDS[chain];
  if (chainId === undefined) {
    throw new Error(
      `deploy-canonical: unknown chain "${chain}"; valid chains: ${Object.keys(CHAIN_IDS).join(", ")}`,
    );
  }
  return chainId;
}

/** Parse argv into { chain, rpc, account?, dryRun, force }. Pure (no env/fs access). */
export function parseArgs(argv) {
  const args = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--chain") args.chain = argv[++i];
    else if (a === "--rpc") args.rpc = argv[++i];
    else if (a === "--account") args.account = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else throw new Error(`deploy-canonical: unknown argument "${a}"`);
  }
  if (!args.chain) throw new Error("deploy-canonical: --chain is required");
  if (!args.rpc) throw new Error("deploy-canonical: --rpc is required");
  return args;
}

/**
 * Decide where the deployer key comes from. Never accepts a plaintext key as
 * a CLI argument. Priority: --account (forge keystore, prompts for password)
 * then DEPLOYER_PRIVATE_KEY (read from env, never echoed).
 */
export function resolveKeySource({ account, env = process.env }) {
  if (account) {
    // Guard: --account takes a forge KEYSTORE NAME, not a raw key. Reject a
    // key-shaped value so a pasted private key is never forwarded to forge (and
    // never sits in shell history under the guise of an account name).
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(account)) {
      throw new Error(
        "deploy-canonical: --account expects a forge keystore NAME, not a private key. " +
          "That value looks like a raw key. Import it once with `cast wallet import <name> --interactive`, " +
          "then pass --account <name>. Never put a key on the command line (it leaks into shell history).",
      );
    }
    return { kind: "account", account };
  }
  if (env.DEPLOYER_PRIVATE_KEY) return { kind: "privateKey", privateKey: env.DEPLOYER_PRIVATE_KEY };
  throw new Error(
    "deploy-canonical: no deployer key source; pass --account <keystore-name> (preferred) or set DEPLOYER_PRIVATE_KEY",
  );
}

/** Build the forge script argv (pure). */
export function composeForgeArgs({ rpc, keySource, broadcast }) {
  const args = ["script", "script/DeployCanonical.s.sol", "--rpc-url", rpc];
  if (keySource.kind === "account") args.push("--account", keySource.account);
  else args.push("--private-key", keySource.privateKey);
  if (broadcast) args.push("--broadcast");
  return args;
}

/**
 * Assert a deployed address matches the known-good canonical address.
 * Throws (never writes) on any mismatch, protecting against wrong
 * bytecode/salt/compiler producing a different address.
 */
export function assertGolden(address) {
  const got = getAddress(address);
  const golden = getAddress(GOLDEN);
  if (got !== golden) {
    throw new Error(
      `deploy-canonical: deployed address ${got} does NOT match the golden canonical address ${golden}; refusing to write the registry (check bytecode/salt/compiler drift)`,
    );
  }
  return got;
}

function defaultRunForge(forgeArgs, { cwd }) {
  const result = spawnSync("forge", forgeArgs, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`deploy-canonical: forge exited with code ${result.status}`);
  }
}

/**
 * Full flow: parse args, resolve the key source, run forge, and (unless
 * --dry-run) verify the deployed address against GOLDEN before writing it to
 * the registry. `runForge`, `readArtifact`, and `registryPath` are injectable
 * so tests never spawn a real forge process or touch the real registry.
 *
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {(forgeArgs: string[], ctx: { cwd: string }) => void} [options.runForge]
 * @param {(artifactPath: string) => string} [options.readArtifact]
 * @param {string} [options.contractsDir]
 * @param {string} [options.registryPath]
 * @param {Record<string, string | undefined>} [options.env]
 * @returns {{ dryRun?: boolean; replaced?: number; address?: string; noop?: boolean }}
 */
export function runDeploy({
  argv = process.argv.slice(2),
  runForge = defaultRunForge,
  readArtifact = addressFromBroadcast,
  contractsDir = CONTRACTS_DIR,
  registryPath,
  env = process.env,
} = {}) {
  const args = parseArgs(argv);
  const chainId = resolveChainId(args.chain);
  const keySource = resolveKeySource({ account: args.account, env });
  const broadcast = !args.dryRun;

  const forgeArgs = composeForgeArgs({ rpc: args.rpc, keySource, broadcast });
  runForge(forgeArgs, { cwd: contractsDir });

  if (args.dryRun) {
    console.log(
      "deploy-canonical: dry run complete (no broadcast, no registry write). Re-run without --dry-run to broadcast.",
    );
    return { dryRun: true };
  }

  const artifactPath = resolve(contractsDir, `broadcast/DeployCanonical.s.sol/${chainId}/run-latest.json`);
  const deployed = readArtifact(artifactPath);
  const golden = assertGolden(deployed);

  const resolvedRegistryPath = registryPath ?? resolve(contractsDir, "src-ts/registry.ts");
  const result = applyWriteback({ registryPath: resolvedRegistryPath, address: golden, force: args.force });
  if (result.noop) {
    console.log(`deploy-canonical: no change (already ${result.address}) at ${resolvedRegistryPath}`);
  } else {
    console.log(
      `deploy-canonical: deployed ${golden} on chainId ${chainId}, wrote it to ${result.replaced} EVM slot(s) in ${resolvedRegistryPath}`,
    );
  }
  return result;
}

// Run as CLI only (not when imported by a test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDeploy();
}
