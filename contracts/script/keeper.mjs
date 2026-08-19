#!/usr/bin/env node
// KeyRegistry keeper node (TDD section 9): fetches JWKS for the configured issuers, diffs
// against what it last saw, and attests new keys / rotations to a deployed KeyRegistry.
// Liveness-only role — anyone can run one, and running one confers no special power beyond
// "one more vote toward quorum." A keeper cannot make a key usable alone (quorum is set at
// KeyRegistry deploy time, > 1 in any real deployment) and cannot un-rotate a mistaken
// rotation attestation (see KeyRegistry.sol's one-way-door comment).
//
// keyHash convention (must match whatever eventually computes a circuit's pubkeyHash public
// output — see OidcRecoveryGuardian's public-inputs doc and the D7 KeyRegistry spec):
//   keyHash = FieldElement.toField(keccak256(rawModulusBytes))
// where rawModulusBytes is the RSA modulus decoded from the JWK's base64url "n" field, NOT
// the JWK JSON, NOT the PEM encoding — the raw big-endian integer bytes.
//
// Usage:
//   node script/keeper.mjs --rpc https://sepolia.base.org --registry 0x... [--dry-run]
//   ATTESTOR_PRIVATE_KEY=0x... node script/keeper.mjs --rpc ... --registry ...
//
// Key handling mirrors deploy-canonical.mjs: never as a CLI arg (shell history / process
// list), only via the ATTESTOR_PRIVATE_KEY env var. --dry-run runs the fetch+diff and prints
// what it WOULD submit without ever touching the private key or sending a transaction.

import { createPublicClient, createWalletClient, http, keccak256, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FIELD_MASK = (1n << 253n) - 1n;
function toField(hex) {
  const masked = BigInt(hex) & FIELD_MASK;
  return "0x" + masked.toString(16).padStart(64, "0");
}

// Issuer set: matches the identity providers the D7 refocus scoped recovery-by-identity to
// (Google/Microsoft/Apple sign-in only — X/Twitter is out, no signed tokens).
const ISSUERS = [
  { issuer: "https://accounts.google.com", jwksUrl: "https://www.googleapis.com/oauth2/v3/certs" },
  { issuer: "https://login.microsoftonline.com", jwksUrl: "https://login.microsoftonline.com/common/discovery/v2.0/keys" },
  { issuer: "https://appleid.apple.com", jwksUrl: "https://appleid.apple.com/auth/keys" },
];

const KEY_REGISTRY_ABI = [
  {
    type: "function", name: "attest", stateMutability: "nonpayable",
    inputs: [{ type: "string", name: "issuer" }, { type: "string", name: "kid" }, { type: "bytes32", name: "keyHash" }],
    outputs: [],
  },
  {
    type: "function", name: "attestRotated", stateMutability: "nonpayable",
    inputs: [{ type: "string", name: "issuer" }, { type: "string", name: "kid" }, { type: "bytes32", name: "keyHash" }],
    outputs: [],
  },
  {
    type: "function", name: "isKeyUsable", stateMutability: "view",
    inputs: [{ type: "string", name: "issuer" }, { type: "string", name: "kid" }, { type: "bytes32", name: "keyHash" }],
    outputs: [{ type: "bool" }],
  },
];

function parseArgs(argv) {
  const args = { dryRun: false, state: "script/keeper-state.json" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rpc") args.rpc = argv[++i];
    else if (a === "--registry") args.registry = argv[++i];
    else if (a === "--state") args.state = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
  }
  return args;
}

// base64url -> raw bytes, then keccak256 -> field-masked keyHash. This is the ONE place the
// keyHash convention lives; keep it in sync with whatever the circuit-side input generator
// eventually does, or attestations here will never match a real proof's public input.
function keyHashFromModulusB64Url(nB64Url) {
  const b64 = nB64Url.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Buffer.from(b64, "base64");
  const digest = keccak256(new Uint8Array(bytes));
  return toField(digest);
}

async function fetchLiveKeys(issuerConfig) {
  const res = await fetch(issuerConfig.jwksUrl);
  if (!res.ok) throw new Error(`JWKS fetch failed for ${issuerConfig.issuer}: HTTP ${res.status}`);
  const { keys } = await res.json();
  return keys
    .filter((k) => k.kty === "RSA" && (k.use === "sig" || !k.use))
    .map((k) => ({ kid: k.kid, keyHash: keyHashFromModulusB64Url(k.n) }));
}

function loadState(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveState(path, state) {
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun && (!args.rpc || !args.registry)) {
    console.error("Usage: keeper.mjs --rpc <url> --registry <address> [--state <path>] [--dry-run]");
    process.exit(1);
  }
  const registryAddress = args.registry ? getAddress(args.registry) : undefined;

  const publicClient = args.rpc ? createPublicClient({ transport: http(args.rpc) }) : undefined;

  const state = loadState(args.state);
  const plan = []; // { action: "attest" | "attestRotated", issuer, kid, keyHash }

  for (const issuerConfig of ISSUERS) {
    let live;
    try {
      live = await fetchLiveKeys(issuerConfig);
    } catch (err) {
      console.error(`[skip] ${issuerConfig.issuer}: ${err.message}`);
      continue;
    }
    const seen = state[issuerConfig.issuer] ?? {};
    const liveKids = new Set(live.map((k) => k.kid));

    for (const { kid, keyHash } of live) {
      if (!seen[kid]) {
        plan.push({ action: "attest", issuer: issuerConfig.issuer, kid, keyHash });
      } else if (seen[kid] !== keyHash) {
        // Same kid, different modulus: providers don't normally do this (kid identifies the
        // exact key), but if it happens, treat the old hash as rotated-out and the new one as
        // a fresh record — never silently reattribute an existing recordId.
        plan.push({ action: "attestRotated", issuer: issuerConfig.issuer, kid, keyHash: seen[kid] });
        plan.push({ action: "attest", issuer: issuerConfig.issuer, kid, keyHash });
      }
    }
    for (const [kid, keyHash] of Object.entries(seen)) {
      if (!liveKids.has(kid)) {
        plan.push({ action: "attestRotated", issuer: issuerConfig.issuer, kid, keyHash });
      }
    }
  }

  if (plan.length === 0) {
    console.log("No changes: every previously-seen key still matches what's live.");
    return;
  }

  console.log(`${plan.length} attestation(s) to submit:`);
  for (const p of plan) console.log(`  ${p.action}(${p.issuer}, ${p.kid}, ${p.keyHash})`);

  if (args.dryRun) {
    console.log("\n--dry-run: not submitting, not touching ATTESTOR_PRIVATE_KEY.");
    return;
  }

  const pk = process.env.ATTESTOR_PRIVATE_KEY;
  if (!pk) {
    console.error("ATTESTOR_PRIVATE_KEY not set. Refusing to submit without it (and refusing to accept it as a CLI arg).");
    process.exit(1);
  }
  const account = privateKeyToAccount(pk);
  const walletClient = createWalletClient({ account, transport: http(args.rpc) });

  for (const p of plan) {
    try {
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: KEY_REGISTRY_ABI,
        functionName: p.action,
        args: [p.issuer, p.kid, p.keyHash],
      });
      console.log(`  ✓ ${p.action}(${p.issuer}, ${p.kid}) -> ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      p.ok = true;
    } catch (err) {
      // AlreadyAttested (we've already voted, someone else's keeper run raced ours) is
      // expected and not an error worth stopping the batch over. Anything else is real --
      // and, critically, NOT ok: an item we never actually got on-chain must stay out of
      // `state` below, or it silently vanishes from every future run's diff (this is exactly
      // what happened live: a transient nonce error dropped one attestation, and the
      // unconditional state update that used to follow this loop marked it "seen" anyway).
      const msg = String(err?.shortMessage ?? err?.message ?? err);
      if (msg.includes("AlreadyAttested")) {
        console.log(`  = ${p.action}(${p.issuer}, ${p.kid}) already attested by this account, skipping`);
        p.ok = true;
      } else {
        console.error(`  ✗ ${p.action}(${p.issuer}, ${p.kid}) failed: ${msg}`);
        p.ok = false;
      }
    }
  }

  // Update state only for plan items that actually landed (a fresh baseline of what's live);
  // rotations just remove the stale kid from what we track as "currently attested by us".
  // Anything that failed keeps its PREVIOUS state entry untouched, so it's still in next run's
  // diff instead of being mistaken for "already handled".
  for (const p of plan) {
    if (!p.ok) continue;
    state[p.issuer] ??= {};
    if (p.action === "attest") state[p.issuer][p.kid] = p.keyHash;
    else delete state[p.issuer][p.kid];
  }
  saveState(args.state, state);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
