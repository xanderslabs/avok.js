import { AccountRole, address, type Instruction } from "@solana/kit";

interface V1Instruction {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
}

function role(isSigner: boolean, isWritable: boolean): AccountRole {
  if (isSigner && isWritable) return AccountRole.WRITABLE_SIGNER;
  if (isSigner) return AccountRole.READONLY_SIGNER;
  if (isWritable) return AccountRole.WRITABLE;
  return AccountRole.READONLY;
}

/** Normalize a web3.js-v1-shaped instruction into a @solana/kit Instruction. */
export function toKitInstruction(v1: V1Instruction): Instruction {
  return {
    programAddress: address(v1.programId),
    accounts: v1.keys.map((k) => ({ address: address(k.pubkey), role: role(k.isSigner, k.isWritable) })),
    data: v1.data,
  };
}
