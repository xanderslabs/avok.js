import type { Address } from "viem";

const DESIGNATOR_PREFIX = "0xef0100";

/** EIP-7702 delegation designator is `0xef0100 ‖ implementation`. */
export function isDelegatedTo(code: `0x${string}`, implementation: Address): boolean {
  return code.toLowerCase() === (DESIGNATOR_PREFIX + implementation.slice(2)).toLowerCase();
}
