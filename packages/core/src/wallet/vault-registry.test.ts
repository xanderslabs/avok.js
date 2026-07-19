import { describe, expect, test } from "vitest";
import type { Address, Hex } from "viem";
import { VaultUnreadableError } from "./vault.js";
import { vaultForChainFromRegistry } from "./vault-registry.js";

const ADDR = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" as Address;
const SLOT = `0x${"11".repeat(32)}` as Hex;
const DEAD_RPC = "http://127.0.0.1:1/definitely-not-an-rpc";

/**
 * THE DISTINCTION THIS WHOLE FEATURE RESTS ON. Both situations below make viem THROW, and both arrive
 * as the same top-level error name (ContractFunctionExecutionError) — so classifying by `error.name`
 * cannot work. Only the cause chain separates them, and getting it backwards is catastrophic in either
 * direction: tell a user on a flaky connection their credential is broken, or tell a user with a dead
 * credential to keep retrying forever.
 *
 * MEASURED against the pinned viem (2.54.6):
 *   ContractFunctionZeroDataError -> the address returned nothing to decode. ABSENT (an orphan).
 *   HttpRequestError et al        -> the chain did not answer. UNREADABLE (retryable, means nothing).
 */
describe("the registry reader distinguishes 'no access slot' from 'no answer'", () => {
  test("a TRANSPORT failure throws VaultUnreadableError — it is NOT evidence the slot is missing", async () => {
    const reader = vaultForChainFromRegistry(10, { evm: { 10: DEAD_RPC } });
    await expect(reader.getAccessSlot(ADDR, SLOT)).rejects.toBeInstanceOf(VaultUnreadableError);
  });

  test("an UNDELEGATED account resolves to null — that is an ORPHAN, not a network problem", async () => {
    // THE TRAP. A fresh wallet has NO CODE until its first transaction, so viem cannot decode a return
    // value and THROWS. Reading that throw as "the network failed, retry" is exactly the bug this plan
    // exists to kill: there is genuinely no access slot here, and no amount of retrying will conjure one.
    //
    // Uses a LIVE rpc and a known-codeless address on purpose: the assertion is about what a real node
    // does for an address with no code, and a mock of the thing under test would prove nothing.
    const reader = vaultForChainFromRegistry(1, { evm: { 1: "https://ethereum-rpc.publicnode.com" } });
    const codeless = "0x000000000000000000000000000000000000dEaD" as Address;
    expect(await reader.getAccessSlot(codeless, SLOT)).toBeNull();
  }, 20_000);

  test("the roster reads still degrade to empty rather than throwing", async () => {
    // Deliberately asymmetric with getAccessSlot: a settings screen that cannot load its list is a
    // cosmetic failure, but a blob that cannot load decides whether someone is locked out of a wallet.
    // Only the latter is allowed to be loud.
    const reader = vaultForChainFromRegistry(10, { evm: { 10: DEAD_RPC } });
    expect(await reader.getAccessSlotIds(ADDR)).toEqual([]);
  });
});
