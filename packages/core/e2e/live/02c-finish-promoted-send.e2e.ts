// LIVE Base Sepolia — completes ONLY the final step of leg (c): the already-promoted key (roster
// registration already confirmed on-chain by 02-guardian-recovery.e2e.ts's executeRecovery() call)
// signs and sends a real transaction. Exists because the monolithic script's own attempt at this step
// raced ahead of its own funding transfer's confirmation (broadcast the promoted-key tx before the
// funding tx was mined) and reverted with insufficient funds — the funding itself DID land seconds
// later. This script just waits for the funding to actually confirm before building the send, using
// the SAME persisted key from `.state/02-resume.json`.
//
// Run: pnpm --dir packages/core exec vitest run --config e2e/vitest.e2e.config.ts e2e/live/02c-finish-promoted-send.e2e.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { describe, it, expect } from "vitest";
import { encodeExecuteBatch } from "../../src/evm/sim-methods.js";
import { readGuardianState } from "../../src/evm/guardian-reads.js";
import { hasLiveFunding, deployerAccount, BASE_SEPOLIA_CHAIN_ID } from "../lib/env.js";
import { makeRpc, explorerTx, waitForTx } from "../lib/chain.js";
import type { Address, Hex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(here, "../.state");
const PREV_STATE_FILE = resolve(STATE_DIR, "01-first-tx-batch.json");
const RESUME_FILE = resolve(STATE_DIR, "02-resume.json");

const canRun = hasLiveFunding() && existsSync(PREV_STATE_FILE) && existsSync(RESUME_FILE);

describe.skipIf(!canRun)("e2e (c) finish: promoted key sends its real transaction", () => {
  it("waits for the promoted key's funding to confirm, then sends", async () => {
    const prev = JSON.parse(readFileSync(PREV_STATE_FILE, "utf8")) as { walletAddress: Address };
    const resume = JSON.parse(readFileSync(RESUME_FILE, "utf8")) as {
      promoteKeyPrivateKey: Hex;
      promoteKeyAddress: Address;
    };
    const wallet = prev.walletAddress;
    const rpc = makeRpc();

    // Confirm the recovery is really executed (not still pending) before trusting the roster.
    const { pending } = await readGuardianState(rpc, wallet);
    expect(pending).toBeNull();

    const promotedAccount = privateKeyToAccount(resume.promoteKeyPrivateKey);
    expect(promotedAccount.address.toLowerCase()).toBe(resume.promoteKeyAddress.toLowerCase());

    // Wait for real, confirmed funds — not just a submitted-but-unmined transfer.
    const deadline = Date.now() + 60_000;
    let balance = await rpc.getBalance(promotedAccount.address);
    while (balance === 0n && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      balance = await rpc.getBalance(promotedAccount.address);
    }
    console.log(`Promoted key balance: ${balance} wei`);
    expect(balance).toBeGreaterThan(0n);

    const promotedNonce = await rpc.getTransactionCount(promotedAccount.address);
    const [tip, baseFee] = await Promise.all([rpc.getMaxPriorityFeePerGas(), rpc.getBaseFeePerGas()]);
    const selfTransferCall = { to: deployerAccount().address, value: 1n, data: "0x" as const };
    const promotedTxSigned = await promotedAccount.signTransaction({
      chainId: BASE_SEPOLIA_CHAIN_ID,
      to: wallet,
      data: encodeExecuteBatch([selfTransferCall]),
      value: 0n,
      nonce: promotedNonce,
      gas: 300_000n,
      maxFeePerGas: baseFee * 2n + tip,
      maxPriorityFeePerGas: tip,
      type: "eip1559",
    });
    const promotedTx = await rpc.sendRawTransaction(promotedTxSigned);
    const promotedReceipt = await waitForTx(promotedTx);
    console.log(`Promoted key's own transaction landed: ${explorerTx(promotedTx)} status=${promotedReceipt.status}`);
    expect(promotedReceipt.status).toBe("success");

    writeFileSync(
      resolve(STATE_DIR, "02-guardian-recovery.json"),
      JSON.stringify({ wallet, promoteKey: resume.promoteKeyAddress, promotedTx }, null, 2),
    );
  });
});
