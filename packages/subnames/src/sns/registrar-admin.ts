import { toKitInstruction } from "./to-kit-instruction.js";
import type { NameMint } from "../port.js";

// Lazily-loaded web3.js-v1 shapes (see sub-registrar.ts for why the deps are dynamic-imported).
interface V1Instruction {
  programId: { toBase58(): string };
  keys: { pubkey: { toBase58(): string }; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
}
interface Schedule {
  length: number;
  price: bigint;
}
interface SubRegisterModule {
  createRegistrar(
    domain: string,
    domainOwner: unknown,
    feePayer: unknown,
    mint: unknown,
    authority: unknown,
    schedule: Schedule[],
    feeAccount: unknown,
    nftGatedCollection: unknown,
    maxNftMint: number | null,
    allowRevoke: boolean,
    programId?: unknown,
  ): Promise<V1Instruction[]>;
  Registrar: {
    retrieve(connection: unknown, key: unknown): Promise<{ mint: { toBase58(): string }; priceSchedule: { price: bigint }[] }>;
  };
}
interface Web3Module {
  Connection: new (endpoint: string) => unknown;
  PublicKey: new (value: string) => unknown;
}

/**
 * Operator-ops helper: build the sub-registrar `createRegistrar` instruction to stand up a PAID
 * subdomain registrar (mint = fee token, schedule = price-by-length, feeAccount = recipient, optional
 * NFT gate). The operator signs+submits it once. Emits a normalized Solana NameMint.
 *
 * NOTE: the user-facing `register` (see sub-registrar.ts) also pays a `bonfidaFeeAccount` protocol
 * cut on top of the operator price — disclose it in the fee preview. web3.js-v1 deps are lazy-loaded.
 */
export async function buildCreateRegistrar(
  cfg: { rpcUrl: string },
  args: {
    domain: string;
    domainOwner: string;
    feePayer: string;
    mint: string;
    authority: string;
    schedule: Schedule[];
    feeAccount: string;
    nftGatedCollection?: string;
    maxNftMint?: number;
    allowRevoke: boolean;
  },
): Promise<NameMint> {
  const { createRegistrar } = (await import("@bonfida/sub-register")) as unknown as SubRegisterModule;
  const { PublicKey } = (await import("@solana/web3.js")) as unknown as Web3Module;
  const pk = (v: string) => new PublicKey(v);
  const ixs = await createRegistrar(
    args.domain,
    pk(args.domainOwner),
    pk(args.feePayer),
    pk(args.mint),
    pk(args.authority),
    args.schedule,
    pk(args.feeAccount),
    args.nftGatedCollection ? pk(args.nftGatedCollection) : null,
    args.maxNftMint ?? null,
    args.allowRevoke,
  );
  return {
    chain: "solana",
    instructions: ixs.map((ix) =>
      toKitInstruction({
        programId: ix.programId.toBase58(),
        keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
        data: new Uint8Array(ix.data),
      }),
    ),
  };
}

/** Read the on-chain registrar's fee mint + price schedule for the pre-sign fee preview. */
export async function readRegistrarFee(cfg: { rpcUrl: string }, registrar: string): Promise<{ mint: string; prices: bigint[] }> {
  const { Registrar } = (await import("@bonfida/sub-register")) as unknown as SubRegisterModule;
  const { Connection, PublicKey } = (await import("@solana/web3.js")) as unknown as Web3Module;
  const state = await Registrar.retrieve(new Connection(cfg.rpcUrl), new PublicKey(registrar));
  return { mint: state.mint.toBase58(), prices: state.priceSchedule.map((s) => s.price) };
}
