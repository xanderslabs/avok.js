import type { Address } from "viem";
import { entryPoint08Abi, entryPoint08Address, entryPoint09Abi, entryPoint09Address } from "viem/account-abstraction";

/**
 * The ERC-4337 EntryPoint versions Avok's 4337 (sponsored) rail can target. An operator picks one
 * per `ClientConfig` (`entryPointVersion`) — Calibur's `ERC4337Account.sol` reads a PER-WALLET,
 * admin-settable storage slot (`updateEntryPoint`, a self-call only the wallet's own admin key can
 * make) to decide which EntryPoint singleton it trusts (`onlyEntryPoint`'s `msg.sender` check), so a
 * client that signs a UserOp hash for the wrong version gets a signature the wallet's own
 * `validateUserOp` will never recognize — the version here MUST match what the target wallet was
 * actually set up with.
 */
export type AvokEntryPointVersion = "0.8" | "0.9";

/**
 * v0.8 — the default: `Static.ENTRY_POINT_V_0_8` in Calibur's vendored `ERC4337Account.sol` is the
 * value `ENTRY_POINT()` returns until a wallet's admin explicitly calls `updateEntryPoint()`, and
 * neither `AvokCalibur.sol` nor `DeployCanonical.s.sol` ever makes that call — so every AvokCalibur
 * wallet trusts v0.8 out of the box. v0.8 also has real bundler support today (Pimlico, Alchemy); v0.9
 * fixes a griefing/censorship issue over v0.8 (not a fund-theft one) but as of 2026-08 has no public
 * bundler yet. An operator who has upgraded their wallets' EntryPoint on-chain opts into "0.9" instead.
 */
export const DEFAULT_ENTRY_POINT_VERSION: AvokEntryPointVersion = "0.8";

export interface EntryPointInfo {
  address: Address;
  abi: typeof entryPoint08Abi | typeof entryPoint09Abi;
}

/** The canonical singleton address + ABI for a given EntryPoint version. */
export function resolveEntryPoint(version: AvokEntryPointVersion): EntryPointInfo {
  switch (version) {
    case "0.8":
      return { address: entryPoint08Address, abi: entryPoint08Abi };
    case "0.9":
      return { address: entryPoint09Address, abi: entryPoint09Abi };
  }
}
