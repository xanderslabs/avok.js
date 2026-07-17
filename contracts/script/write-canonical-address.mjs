#!/usr/bin/env node
// Writes the deployed canonical AvokWalletImplementation address into the EVM
// entries of src-ts/registry.ts, replacing the `canonicalImplementation: PENDING`
// placeholders. The CREATE2 address is uniform across every EVM chain, so a single
// address is written to ALL EVM chains at once.
//
// FUND-CRITICAL context: this address is the EIP-7702 delegation target. It is only
// run (by the founder) AFTER the real deterministic deploy (Task 9). Until then the
// registry stays PENDING and its guards fail loud.
//
// Usage:
//   node script/write-canonical-address.mjs --address 0x<checksummed-20-byte-addr>
//   node script/write-canonical-address.mjs --address 0x... --force
//   node script/write-canonical-address.mjs --address 0x... --registry <path/to/registry.ts>
//   node script/write-canonical-address.mjs --broadcast broadcast/DeployCanonical.s.sol/<chainId>/run-latest.json
//
// Idempotent: re-running with the same address is a no-op. Refuses to overwrite an
// already-set (non-PENDING) address unless --force is passed. Fail-loud on: no/invalid
// address, missing registry, or no writable slots.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getAddress, isAddress } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000";
// Matches only the `canonicalImplementation:` key (feeds use `address:`), so feed
// PENDING placeholders are never touched.
const SLOT_RE = /canonicalImplementation:\s*(PENDING|"0x[0-9a-fA-F]{40}")/g;

/** Extract the AvokWalletImplementation contract address from a forge broadcast artifact. */
export function addressFromBroadcast(path) {
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  const txs = artifact.transactions ?? [];
  const create = txs.find(
    (t) =>
      (t.transactionType === "CREATE" || t.transactionType === "CREATE2") &&
      t.contractName === "AvokWalletImplementation" &&
      t.contractAddress,
  );
  if (!create) {
    throw new Error(`write-canonical-address: no AvokWalletImplementation create tx in ${path}`);
  }
  return create.contractAddress;
}

/**
 * Apply the writeback to a registry file on disk.
 * @returns {{ replaced: number, address: string, noop: boolean }}
 */
export function applyWriteback({ registryPath, address, force = false }) {
  if (!address) throw new Error("write-canonical-address: no address provided");
  if (!isAddress(address)) {
    throw new Error(`write-canonical-address: invalid address "${address}"`);
  }
  // Normalize to EIP-55 checksum; reject the zero address.
  const checksummed = getAddress(address);
  if (checksummed === ZERO) {
    throw new Error("write-canonical-address: refusing to write the zero address");
  }
  if (!existsSync(registryPath)) {
    throw new Error(`write-canonical-address: registry not found at ${registryPath}`);
  }

  const src = readFileSync(registryPath, "utf8");
  const target = `"${checksummed}"`;

  const matches = [...src.matchAll(SLOT_RE)];
  if (matches.length === 0) {
    throw new Error("write-canonical-address: no canonicalImplementation slots found in registry");
  }

  let pending = 0;
  let alreadyTarget = 0;
  let otherSet = 0;
  for (const m of matches) {
    if (m[1] === "PENDING") pending += 1;
    else if (m[1] === target) alreadyTarget += 1;
    else otherSet += 1;
  }

  // Already fully written to the requested address → idempotent no-op.
  if (pending === 0 && otherSet === 0) {
    return { replaced: 0, address: checksummed, noop: true };
  }
  // Refuse to clobber a different, already-set address unless forced.
  if (otherSet > 0 && !force) {
    throw new Error(
      `write-canonical-address: ${otherSet} slot(s) already set to a different address; pass --force to overwrite`,
    );
  }

  let replaced = 0;
  const out = src.replace(SLOT_RE, (whole, current) => {
    if (current === "PENDING" || force || current === target) {
      if (current !== target) replaced += 1;
      return `canonicalImplementation: ${target}`;
    }
    return whole; // leave a different set value untouched (non-force path handled above)
  });

  writeFileSync(registryPath, out);
  return { replaced, address: checksummed, noop: replaced === 0 };
}

function parseArgs(argv) {
  const args = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--address") args.address = argv[++i];
    else if (a === "--registry") args.registry = argv[++i];
    else if (a === "--broadcast") args.broadcast = argv[++i];
    else throw new Error(`write-canonical-address: unknown argument "${a}"`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const registryPath = args.registry
    ? resolve(process.cwd(), args.registry)
    : resolve(here, "../src-ts/registry.ts");

  let address = args.address;
  if (!address && args.broadcast) address = addressFromBroadcast(resolve(process.cwd(), args.broadcast));

  const result = applyWriteback({ registryPath, address, force: args.force });
  if (result.noop) {
    console.log(`write-canonical-address: no change (already ${result.address}) at ${registryPath}`);
  } else {
    console.log(
      `write-canonical-address: wrote ${result.address} to ${result.replaced} EVM slot(s) in ${registryPath}`,
    );
  }
}

// Run as CLI only (not when imported by a test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
