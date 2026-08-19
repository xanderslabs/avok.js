// LIVE Base Sepolia — E2E leg (c): full guardian recovery (TDD §7).
//
// Requires 01-first-tx-batch.e2e.ts to have run first (needs its state file: the wallet + guardian).
//
// Exercises, in one continuous flow on the wallet 01 created:
//   1. Guardian approval (approveRecoveryBySig, permissionless relay) opens a pending recovery.
//   2. The veto path: the wallet's root device vetoes it before the timelock elapses.
//   3. A fresh guardian approval (nonce probed on-chain — see the NONCE note below) starts a new
//      recovery.
//   4. A REAL 1-hour wait (the contract's MIN_DELAY; see contracts/src/GuardianLogic.sol) — approved by
//      the user for this run rather than fork-only time travel.
//   5. `executeRecovery()` (permissionless) promotes the new key onto the Calibur roster.
//   6. The promoted (non-root, "roster") key signs and sends a REAL transaction that lands.
//
// RESUMABILITY: this script's own process was killed by something external to this session partway
// through an earlier run, mid-timelock. Two lessons are baked in as a result:
//   - The promoted key's private key is generated off-chain and NEVER appears in any contract call
//     (only its address does), so it is NOT recoverable from chain state if the process dies before
//     persisting it. This script now writes it to `.state/02-resume.json` IMMEDIATELY after
//     generating it, before submitting the approval that starts its timelock.
//   - On start, it reads the wallet's ACTUAL on-chain pending-recovery state (never trusts an
//     in-memory belief about "which step") and either resumes the matching in-flight recovery (if its
//     key was persisted) or vetoes whatever is pending (if its key was lost, as happened once already
//     this session) before starting a fresh one.
//
// NONCE NOTE (confirmed by reading GuardianLogic.sol, not guessed): `vetoRecovery()` and
// `executeRecovery()` both increment `recoveryNonce`, and there is no public getter for it —
// `readGuardianState`'s own doc comment (evm/guardian-reads.ts) flags that `getPendingRecovery()`'s
// returned `nonce` only reflects the counter while a recovery is genuinely pending, and resets to 0
// (uninformative) once it's cleared. Rather than hand-track the counter (fragile across kills), this
// script PROBES for the valid nonce with `estimateGas` (a free, read-only call that reverts exactly
// like the real send would on `NonceUsed`) — a real SDK consumer has no cheaper way to discover this
// value than reading Solidity source or probing the same way.
//
// SDK GAP FOUND, not improvised around: `client/evm.ts`'s native-gas `send()` (pre-fix) always
// sourced its transaction nonce from `rpc.getTransactionCount(batch.walletAddress)` — correct ONLY
// when the signer's own address equals the wallet address (the founding/root device). A promoted
// (roster, non-root) key calls `wallet.execute(...)` as an ordinary EOA with `to: walletAddress` and
// `from` its OWN, DIFFERENT address (confirmed by reading `Calibur.sol#execute` — it authorizes by
// `msg.sender.toKeyHash()`), so the nonce belongs to the SIGNER, not the wallet. This has since been
// fixed upstream (`requireSignerAddress()` + `Account.evm.signerAddress`); this script still builds
// the promoted key's final send with its own low-level primitives (already working, no need to
// switch just because the fix landed).
//
// Run: pnpm --dir packages/core exec vitest run --config e2e/vitest.e2e.config.ts e2e/live/02-guardian-recovery.e2e.ts
// Requires: 01's state file, and DEPLOYER_KEY funded with Base Sepolia ETH. Skips cleanly without either.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { describe, it, expect } from "vitest";
import { GuardianLogicABI } from "@avokjs/contracts";
import { readGuardianState } from "../../src/evm/guardian-reads.js";
import { encodeExecuteBatch } from "../../src/evm/sim-methods.js";
import { approveWithImportedKey } from "../../src/vault/recover/approve.js";
import { hasLiveFunding, deployerAccount, BASE_SEPOLIA_CHAIN_ID } from "../lib/env.js";
import { baseSepolia, makeRpc, explorerTx, waitForTx } from "../lib/chain.js";
import { reconstructAvokWallet } from "../lib/wallet.js";
import { makeDirectConnection } from "../lib/direct-connection.js";
import type { WalletState } from "../../src/wallet/sandbox.js";

const here = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(here, "../.state");
const PREV_STATE_FILE = resolve(STATE_DIR, "01-first-tx-batch.json");
const RESUME_FILE = resolve(STATE_DIR, "02-resume.json");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface ResumeState {
  promoteKeyPrivateKey: Hex;
  promoteKeyAddress: Address;
}

function loadResume(): ResumeState | undefined {
  if (!existsSync(RESUME_FILE)) return undefined;
  return JSON.parse(readFileSync(RESUME_FILE, "utf8")) as ResumeState;
}

function saveResume(s: ResumeState): void {
  writeFileSync(RESUME_FILE, JSON.stringify(s, null, 2));
}

const canRun = hasLiveFunding() && existsSync(PREV_STATE_FILE);

describe.skipIf(!canRun)("e2e (c): full guardian recovery, live Base Sepolia", () => {
  it(
    "approves, vetoes, re-approves, waits out the real timelock, promotes, and the promoted key sends",
    async () => {
      const prev = JSON.parse(readFileSync(PREV_STATE_FILE, "utf8")) as {
        walletAddress: Address;
        walletSeed: number;
        walletRpId: string;
        walletState: WalletState;
        guardianAddress: Address;
        guardianPrivateKey: Hex;
      };
      const wallet = prev.walletAddress;
      const guardianKey = prev.guardianPrivateKey;
      const guardian = privateKeyToAccount(guardianKey);
      expect(guardian.address.toLowerCase()).toBe(prev.guardianAddress.toLowerCase());
      console.log(`Recovering wallet: ${wallet}`);

      const rpc = makeRpc();
      const deployer = deployerAccount();
      const relayerWallet = createWalletClient({ account: deployer, chain: baseSepolia, transport: http() });

      // ---- Ensure a clean slate: veto whatever is pending UNLESS we already hold its promoted key ----
      let pendingNow = (await readGuardianState(rpc, wallet)).pending;
      let resume = loadResume();

      const vetoedFirst = pendingNow !== null;
      if (pendingNow && (!resume || resume.promoteKeyAddress.toLowerCase() !== pendingNow.promoteKey.toLowerCase())) {
        console.log(
          `A pending recovery exists (promoteKey=${pendingNow.promoteKey}) with no matching persisted key — ` +
            "its private key was lost to an earlier interrupted run. Vetoing it before starting fresh.",
        );
        const rootHandle = await reconstructAvokWallet({ seed: prev.walletSeed, rpId: prev.walletRpId, state: prev.walletState });
        const rootConnection = makeDirectConnection({ state: rootHandle.state, passkey: rootHandle.passkey });
        const vetoCall = {
          to: wallet,
          value: 0n,
          data: encodeFunctionData({ abi: GuardianLogicABI, functionName: "vetoRecovery", args: [] }),
        };
        const rootNonce = await rpc.getTransactionCount(wallet);
        const [tip, baseFee] = await Promise.all([rpc.getMaxPriorityFeePerGas(), rpc.getBaseFeePerGas()]);
        const vetoTxSigned = await rootConnection.signSend({
          tx: {
            chainId: BASE_SEPOLIA_CHAIN_ID,
            to: wallet,
            data: encodeExecuteBatch([vetoCall]),
            value: 0n,
            nonce: rootNonce,
            gas: 300_000n,
            maxFeePerGas: baseFee * 2n + tip,
            maxPriorityFeePerGas: tip,
            type: "eip1559",
          },
        });
        const vetoTx = await rpc.sendRawTransaction(vetoTxSigned);
        await waitForTx(vetoTx);
        console.log(`Veto submitted by root device: ${explorerTx(vetoTx)}`);
        const afterVeto = await readGuardianState(rpc, wallet);
        expect(afterVeto.pending).toBeNull();
        console.log("Pending recovery cleared by veto — veto path confirmed.");
        pendingNow = null;
        resume = undefined;
      }
      console.log(`Veto path exercised this run: ${vetoedFirst}`);

      // ---- Start (or resume) the recovery that will actually be carried to promotion ----
      let promoteKey: Address;
      let promoteKeyPrivateKey: Hex;
      if (pendingNow && resume) {
        // Resuming an in-flight recovery whose key we still hold.
        promoteKey = resume.promoteKeyAddress;
        promoteKeyPrivateKey = resume.promoteKeyPrivateKey;
        console.log(`Resuming in-flight recovery: promoteKey=${promoteKey}, readyAt=${pendingNow.readyAt}`);
      } else {
        // Probe for the correct nonce (see NONCE NOTE) with free estimateGas calls — no on-chain
        // effect, no gas spent, just reverts until it finds the one the contract actually expects.
        const probePromoteKey = privateKeyToAccount(generatePrivateKey()).address;
        let validNonce: bigint | undefined;
        for (let n = 0n; n <= 5n; n++) {
          const probe = await approveWithImportedKey({
            privateKey: guardianKey,
            wallet,
            chainId: BASE_SEPOLIA_CHAIN_ID,
            promoteKey: probePromoteKey,
            nonce: n,
          });
          const calldata = encodeFunctionData({
            abi: GuardianLogicABI,
            functionName: "approveRecoveryBySig",
            args: [probe.promoteKey, probe.nonce, probe.guardian, probe.signature],
          });
          try {
            await rpc.estimateGas({ from: deployer.address, to: wallet, data: calldata });
            validNonce = n;
            break;
          } catch {
            // NonceUsed (or similar) — try the next candidate.
          }
        }
        if (validNonce === undefined) throw new Error("Could not find a valid recoveryNonce in [0, 5] — aborting.");
        console.log(`Probed valid recoveryNonce: ${validNonce}`);

        promoteKeyPrivateKey = generatePrivateKey();
        promoteKey = privateKeyToAccount(promoteKeyPrivateKey).address;
        // PERSIST BEFORE SUBMITTING — this is the exact ordering the earlier interrupted run lacked.
        saveResume({ promoteKeyPrivateKey, promoteKeyAddress: promoteKey });

        const approval = await approveWithImportedKey({
          privateKey: guardianKey,
          wallet,
          chainId: BASE_SEPOLIA_CHAIN_ID,
          promoteKey,
          nonce: validNonce,
        });
        const approveTx = await relayerWallet.sendTransaction({
          to: wallet,
          data: encodeFunctionData({
            abi: GuardianLogicABI,
            functionName: "approveRecoveryBySig",
            args: [approval.promoteKey, approval.nonce, approval.guardian, approval.signature],
          }),
        });
        await waitForTx(approveTx);
        console.log(`Approval submitted (nonce=${validNonce}): ${explorerTx(approveTx)}`);

        const afterApproval = await readGuardianState(rpc, wallet);
        expect(afterApproval.pending?.promoteKey.toLowerCase()).toBe(promoteKey.toLowerCase());
        pendingNow = afterApproval.pending;
      }

      const readyAt = pendingNow!.readyAt;
      console.log(`Pending recovery: promoteKey=${promoteKey}, readyAt=${readyAt} (unix seconds)`);

      // ---- REAL wait out the timelock (approved: no vm.warp shortcut on the live run) ----
      const nowSec = () => Math.floor(Date.now() / 1000);
      const bufferSec = 30;
      while (nowSec() < readyAt + bufferSec) {
        const remaining = readyAt + bufferSec - nowSec();
        console.log(`Waiting for timelock: ${remaining}s remaining...`);
        await sleep(Math.min(remaining, 60) * 1000);
      }

      // ---- executeRecovery() (permissionless) promotes promoteKey ----
      const execTx = await relayerWallet.sendTransaction({
        to: wallet,
        data: encodeFunctionData({ abi: GuardianLogicABI, functionName: "executeRecovery", args: [] }),
      });
      await waitForTx(execTx);
      console.log(`executeRecovery submitted: ${explorerTx(execTx)}`);

      const afterExecute = await readGuardianState(rpc, wallet);
      expect(afterExecute.pending).toBeNull();
      console.log("Recovery executed — promoteKey should now be a registered roster admin.");

      // ---- The promoted (non-root) key signs and sends a REAL transaction ----
      const promotedAccount = privateKeyToAccount(promoteKeyPrivateKey);
      const promotedNonce = await rpc.getTransactionCount(promotedAccount.address);
      const [tip2, baseFee2] = await Promise.all([rpc.getMaxPriorityFeePerGas(), rpc.getBaseFeePerGas()]);
      const PROMOTED_KEY_FUNDING_WEI = 300_000_000_000_000n; // 0.0003 ETH — ample at these gas prices
      await relayerWallet.sendTransaction({ to: promotedAccount.address, value: PROMOTED_KEY_FUNDING_WEI });
      const selfTransferCall = { to: deployerAccount().address, value: 1n, data: "0x" as const };
      const promotedTxSigned = await promotedAccount.signTransaction({
        chainId: BASE_SEPOLIA_CHAIN_ID,
        to: wallet,
        data: encodeExecuteBatch([selfTransferCall]),
        value: 0n,
        nonce: promotedNonce,
        gas: 300_000n,
        maxFeePerGas: baseFee2 * 2n + tip2,
        maxPriorityFeePerGas: tip2,
        type: "eip1559",
      });
      const promotedTx = await rpc.sendRawTransaction(promotedTxSigned);
      const promotedReceipt = await waitForTx(promotedTx);
      console.log(`Promoted key's own transaction landed: ${explorerTx(promotedTx)} status=${promotedReceipt.status}`);
      expect(promotedReceipt.status).toBe("success");

      writeFileSync(
        resolve(STATE_DIR, "02-guardian-recovery.json"),
        JSON.stringify({ wallet, promoteKey, execTx, promotedTx, readyAt }, null, 2),
      );
    },
    2 * 60 * 60 * 1000,
  );
});
