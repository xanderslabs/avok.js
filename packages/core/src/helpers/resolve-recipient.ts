/**
 * App-wide recipient resolution — the reusable Avok pattern: anywhere an app takes an address,
 * accept a raw 0x address OR any ENS (or supported name-service) name, resolve it via a
 * `NameResolver` (`createNameResolver`), and pass the resolved address into your tx args.
 *
 * Takes a RESOLVER, not a client: resolution is not a wallet verb, so this helper carries no wallet
 * coupling and works in any app.
 *
 * Returns `{ address, resolvedFrom? }` (resolvedFrom set only when a name was resolved) or
 * `{ error }` with copy suitable to render inline.
 */
import { isAddress as isEvmAddress } from "viem";
import type { NameResolver } from "./resolver.js";

export type ResolveResult = { address: string; resolvedFrom?: string } | { error: string };

export async function resolveRecipient(resolver: NameResolver, input: string): Promise<ResolveResult> {
  const value = input.trim();
  if (!value) return { error: "Enter a recipient address or name." };

  if (isEvmAddress(value)) return { address: value };

  if (!value.includes(".")) {
    return { error: "Enter a valid 0x address or a name (like alice.eth)." };
  }

  const resolved = await resolver.resolveForward(value);
  if (!resolved) return { error: `No address found for ${value}.` };

  if (resolved.evm) return { address: resolved.evm, resolvedFrom: value };
  return { error: `No EVM address found for ${value}.` };
}
