// LIVE Base Sepolia — E2E leg (a): the first-transaction batch (TDD §6 "First transaction").
//
// Builds one atomic native-gas send: 7702 authorization (signed by K) + delegate designation +
// guardian setup, batched with the user's actual transaction (a real native-ETH transfer), sent
// through the real SDK (`createEvmNamespace` from `client/evm.ts`) over a headless `Connection`
// (`e2e/lib/direct-connection.ts`) that signs with the SAME `withWalletKey`/`performSign` primitives
// the browser popup uses.
//
// SPEC CONTRADICTION FOUND, not improvised around (see the console warning below): the TDD's
// "roster registration of the acting device key" cannot apply to the FOUNDING device. Calibur's
// `KeyManagement.sol#register` explicitly reverts `CannotRegisterRootKey()` for the founding
// device's own key — it is the implicit root key from the moment delegation lands, never a roster
// entry. This leg therefore batches delegate + guardian-setup + the user's transaction, WITHOUT a
// register() call, and reports the contradiction rather than papering over it with a call that
// would revert.
//
// Run: pnpm --dir packages/core exec vitest run --config e2e/vitest.e2e.config.ts e2e/live/01-first-tx-batch.e2e.ts
// Requires: DEPLOYER_KEY (env or contracts/.env) funded with Base Sepolia ETH. Skips cleanly without it.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { createEvmNamespace } from "../../src/client/evm.js";
import type { ClientConfig } from "../../src/types.js";
import { buildSetupGuardiansCall } from "../../src/evm/guardian-calls.js";
import { readGuardianState } from "../../src/evm/guardian-reads.js";
import { getChainProfile, isDelegatedTo } from "../../src/evm/index.js";
import { makeDirectConnection } from "../lib/direct-connection.js";
import { createFreshAvokWallet, generateGuardianKey } from "../lib/wallet.js";
import { hasLiveFunding, deployerAccount, BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_RPC } from "../lib/env.js";
import { fundFromDeployer, makeRpc, explorerTx, explorerAddress } from "../lib/chain.js";

const here = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(here, "../.state");

const RECOVERY_DELAY_SECONDS = 3600; // contract MIN_DELAY — the shortest live-test-viable value
const GUARDIAN_OP_DELAY_SECONDS = 3600;
const FUND_AMOUNT_WEI = 4_000_000_000_000_000n; // 0.004 ETH: batch gas + headroom for later legs

describe.skipIf(!hasLiveFunding())("e2e (a): first-transaction batch, live Base Sepolia", () => {
  it("delegates + sets up guardians + sends the user's transaction in one atomic batch", async () => {
    mkdirSync(STATE_DIR, { recursive: true });
    console.log(
      "WARNING (spec contradiction, reported not improvised around): the TDD's first-tx description " +
        "includes 'roster registration of the acting device key'. For the FOUNDING device that key IS " +
        "the implicit Calibur root key — KeyManagement.sol#register reverts CannotRegisterRootKey() for " +
        "it. This leg omits that call for exactly that reason.",
    );

    const wallet = await createFreshAvokWallet({ networkName: "Avok E2E" });
    const walletAddress = wallet.state.walletAddress;
    console.log(`Fresh wallet address: ${walletAddress} (${explorerAddress(walletAddress)})`);

    const guardian = generateGuardianKey();
    console.log(`Fresh guardian address (throwaway, key-import branch): ${guardian.address}`);

    console.log(`Funding wallet with ${FUND_AMOUNT_WEI} wei from the deployer...`);
    const fundTx = await fundFromDeployer(walletAddress, FUND_AMOUNT_WEI);
    console.log(`  funded: ${explorerTx(fundTx)}`);

    const rpc = makeRpc();

    const chain = getChainProfile(BASE_SEPOLIA_CHAIN_ID)!;
    const preCode = await rpc.getCode(walletAddress);
    expect(isDelegatedTo(preCode, chain.canonicalImplementation)).toBe(false);

    const connection = makeDirectConnection({ state: wallet.state, passkey: wallet.passkey });
    const config: ClientConfig = { connection, deps: { rpc } };
    const evm = createEvmNamespace(config);

    const guardianSetupCall = buildSetupGuardiansCall({
      wallet: walletAddress,
      guardians: [guardian.address],
      threshold: 1,
      recoveryDelaySeconds: RECOVERY_DELAY_SECONDS,
      guardianOpDelaySeconds: GUARDIAN_OP_DELAY_SECONDS,
    });

    // The user's actual transaction, batched atomically with delegation + guardian setup: a tiny
    // native-ETH transfer back to the deployer (proves the wallet moves real value in the SAME send).
    const userTransferCall = { to: deployerAccount().address, value: 1n, data: "0x" as const };

    console.log("Sending the atomic batch (7702 auth + delegate + guardian setup + user transfer)...");
    const receipt = await evm.send([guardianSetupCall, userTransferCall], { chainId: BASE_SEPOLIA_CHAIN_ID });
    console.log(`  submitted: rail=${receipt.rail} status=${receipt.status} id=${receipt.id}`);
    const finalReceipt = await evm.wait(receipt, { timeoutMs: 120_000 });
    console.log(
      `  final: status=${finalReceipt.status}${finalReceipt.txHash ? ` tx=${explorerTx(finalReceipt.txHash)}` : ""}`,
    );
    expect(finalReceipt.status).toBe("confirmed");

    const postCode = await rpc.getCode(walletAddress);
    const delegated = isDelegatedTo(postCode, chain.canonicalImplementation);
    console.log(`Post-batch delegation state: ${delegated ? "delegated ✓" : "STILL UNDELEGATED ✗"}`);
    expect(delegated).toBe(true);

    const { config: guardianConfig } = await readGuardianState(rpc, walletAddress);
    console.log(
      `Guardian config on-chain: guardians=[${guardianConfig.guardians.join(",")}] threshold=${guardianConfig.threshold} ` +
        `recoveryDelay=${guardianConfig.recoveryDelaySeconds}s guardianOpDelay=${guardianConfig.guardianOpDelaySeconds}s`,
    );
    expect(guardianConfig.guardians.map((g) => g.toLowerCase())).toEqual([guardian.address.toLowerCase()]);
    expect(guardianConfig.threshold).toBe(1);

    const balance = await rpc.getBalance(walletAddress);
    console.log(`Wallet native balance after batch: ${balance} wei`);

    const outFile = resolve(STATE_DIR, "01-first-tx-batch.json");
    writeFileSync(
      outFile,
      JSON.stringify(
        {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          rpc: BASE_SEPOLIA_RPC,
          walletAddress,
          walletSeed: wallet.seed,
          walletRpId: wallet.rpId,
          walletState: wallet.state,
          guardianAddress: guardian.address,
          guardianPrivateKey: guardian.privateKey,
          fundTx,
          batchTx: finalReceipt.txHash,
          recoveryDelaySeconds: RECOVERY_DELAY_SECONDS,
          guardianOpDelaySeconds: GUARDIAN_OP_DELAY_SECONDS,
        },
        null,
        2,
      ),
    );
    console.log(`\nState written to ${outFile} (needed by 02-guardian-recovery.e2e.ts).`);
  });
});
