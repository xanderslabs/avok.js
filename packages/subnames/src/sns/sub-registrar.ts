import type { SnsRpc } from "./index.js";

/** Neutral v1-instruction shape that createSnsNameService normalizes to a kit Instruction. */
type V1Ix = { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: Uint8Array };

// Minimal structural types for the lazily-loaded web3.js-v1 deps. We DYNAMIC-import both
// @bonfida/sub-register and @solana/web3.js inside the returned function so that merely importing
// the naming module never eagerly loads the heavy web3.js-v1 tree (and its module-init PDA
// derivations, which can misbehave under some bundler/test environments). The deps load only when a
// user actually mints an SNS name. Verified against @bonfida/sub-register@0.1.0 dist/bindings.d.ts:
//   register(connection, registrar, buyer, nftAccount, subDomain, programId?) => TransactionInstruction[]
// `buyer` is the user's wallet — the permissionless self-registration signer.
interface V1Instruction {
  programId: { toBase58(): string };
  keys: { pubkey: { toBase58(): string }; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
}
interface SubRegisterModule {
  register(
    connection: unknown,
    registrar: unknown,
    buyer: unknown,
    nftAccount: unknown,
    subDomain: string,
    programId?: unknown,
  ): Promise<V1Instruction[]>;
}
interface Web3Module {
  Connection: new (endpoint: string) => unknown;
  PublicKey: (new (value: string) => unknown) & { default: unknown };
}

/**
 * Default SNS write path: Bonfida sub-registrar `register` — permissionless user self-registration.
 * The buyer is the user's wallet (who signs+submits via the Solana fronted/relayer path); registrar
 * policy (fee / NFT-gate / price schedule) is enforced on-chain. Emits web3.js-v1 instructions,
 * returned here in a neutral shape for `toKitInstruction` normalization.
 *
 * On-chain specifics (exact subDomain string form, nftAccount handling for fee-based registrars) are
 * device/cluster-gated — verify on devnet before mainnet.
 */
export function createSubRegistrarRegister(cfg: { rpcUrl: string; nftAccount?: string; programId?: string }) {
  return async (a: { rpc: SnsRpc; registrar: string; parent: string; label: string; owner: string }): Promise<V1Ix[]> => {
    const { register } = (await import("@bonfida/sub-register")) as unknown as SubRegisterModule;
    const { Connection, PublicKey } = (await import("@solana/web3.js")) as unknown as Web3Module;
    const connection = new Connection(cfg.rpcUrl);
    const ixs = await register(
      connection,
      new PublicKey(a.registrar),
      new PublicKey(a.owner),
      cfg.nftAccount ? new PublicKey(cfg.nftAccount) : PublicKey.default,
      a.label,
      cfg.programId ? new PublicKey(cfg.programId) : undefined,
    );
    return ixs.map((ix) => ({
      programId: ix.programId.toBase58(),
      keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
      data: new Uint8Array(ix.data),
    }));
  };
}
