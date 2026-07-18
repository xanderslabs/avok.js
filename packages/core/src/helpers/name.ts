import { concat, keccak256, namehash, toBytes, type Hex } from "viem";
import { normalize } from "viem/ens";

/** Normalize an subname label/name per ENS (the only safe normalization for resolution). */
export function normalizeSubname(name: string): string {
  return normalize(name);
}

/** ENS namehash node of the full subname (`label.parent`). */
export function subnameNamehash(name: string): Hex {
  return namehash(name);
}

/** Full normalized name from a label + parent. */
export function fullName(label: string, parent: string): string {
  return `${normalizeSubname(label)}.${parent}`;
}

/** EIP-137 subnode: keccak256(parentNode ‖ keccak256(utf8(label))). */
export function subnameNode(parentNode: Hex, label: string): Hex {
  const labelHash = keccak256(toBytes(normalizeSubname(label)));
  return keccak256(concat([parentNode, labelHash]));
}
