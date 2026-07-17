/**
 * App-wide recipient resolution — the reusable Avok pattern: anywhere an app takes an address,
 * accept a raw address for the rail OR any ENS/SNS (or supported name-service) name, resolve it via
 * a `NameResolver` (`createNameResolver`), and pass the resolved address into your tx args.
 *
 * Takes a RESOLVER, not a client: resolution is not a wallet verb (#6 spun the subname surface out
 * of the core client), so this helper carries no wallet coupling and works in any app.
 *
 * Returns `{ address, resolvedFrom? }` (resolvedFrom set only when a name was resolved) or
 * `{ error }` with copy suitable to render inline.
 */
import { isAddress as isEvmAddress } from "viem";
import { isAddress as isSolanaAddress } from "@solana/kit";
import type { NameResolver } from "./resolver.js";

export type Rail = "evm" | "solana";

export type ResolveResult = { address: string; resolvedFrom?: string } | { error: string };

export async function resolveRecipient(
  resolver: NameResolver,
  input: string,
  rail: Rail,
): Promise<ResolveResult> {
  const value = input.trim();
  if (!value) return { error: "Enter a recipient address or name." };

  const isRawForRail = rail === "evm" ? isEvmAddress(value) : isSolanaAddress(value);
  if (isRawForRail) return { address: value };

  if (!value.includes(".")) {
    return {
      error:
        rail === "evm"
          ? "Enter a valid 0x address or a name (like alice.eth)."
          : "Enter a valid Solana address or a name (like alice.sol).",
    };
  }

  const resolved = await resolver.resolveForward(value);
  if (!resolved) return { error: `No address found for ${value}.` };

  if (rail === "evm") {
    if (resolved.evm) return { address: resolved.evm, resolvedFrom: value };
    if (resolved.solana) return { error: `${value} resolves to a Solana address — switch to the Solana rail to send to it.` };
    return { error: `No EVM address found for ${value}.` };
  }
  if (resolved.solana) return { address: resolved.solana, resolvedFrom: value };
  if (resolved.evm) return { error: `${value} resolves to an EVM address — switch to the EVM rail to send to it.` };
  return { error: `No Solana address found for ${value}.` };
}
