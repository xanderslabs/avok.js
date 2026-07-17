import type { Instruction } from "@solana/kit";
import { toKitInstruction } from "./to-kit-instruction.js";
import type { NameMint, NameMintInput } from "../port.js";

export { createSubRegistrarRegister } from "./sub-registrar.js";
export { buildCreateRegistrar, readRegistrarFee } from "./registrar-admin.js";
export { toKitInstruction };

/** The kit Rpc surface. Kept opaque here; the real Rpc is supplied at the wiring site. */
export type SnsRpc = unknown;

type V1Instruction = { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: Uint8Array };

function normalize(ix: V1Instruction | Instruction): Instruction {
  return "programId" in ix ? toKitInstruction(ix) : ix;
}

/**
 * SNS registration adapter. Non-custodial intent: `buildMintAsync` returns the subdomain-creation
 * instruction(s) for the APP to submit via the Solana Wallet Standard — this package never sends.
 * The concrete register builder is INJECTED (`buildRegister`) so the SNS write program can be chosen
 * at the wiring site; whatever it emits (kit or v1 shape) is normalized. Resolution lives in
 * @avokjs/helpers (createSnsResolver).
 */
export function createSnsRegistrar(opts: {
  rpc: SnsRpc;
  parent?: string;
  registrar?: string;
  buildRegister?: (a: {
    rpc: SnsRpc;
    registrar: string;
    parent: string;
    label: string;
    owner: string;
  }) => Promise<V1Instruction | Instruction | (V1Instruction | Instruction)[]>;
}): { buildMintAsync(input: NameMintInput): Promise<NameMint> } {
  return {
    async buildMintAsync(input: NameMintInput): Promise<NameMint> {
      if (!opts.parent || !opts.registrar || !opts.buildRegister) {
        throw new Error("SNS buildMintAsync requires parent + registrar + buildRegister");
      }
      const built = await opts.buildRegister({
        rpc: opts.rpc,
        registrar: opts.registrar,
        parent: opts.parent,
        label: input.label,
        owner: input.owner,
      });
      const list = Array.isArray(built) ? built : [built];
      return { chain: "solana", instructions: list.map(normalize) };
    },
  };
}
