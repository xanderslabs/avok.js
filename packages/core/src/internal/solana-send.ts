import { base58 } from "@scure/base";
import { solanaRpcUrl } from "@avokjs/contracts";
import { createSolanaRpcClient, createKora, type KoraClient, type SolanaRpcClient } from "../solana/index.js";
import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  getBase64EncodedWireTransaction,
  type Address,
  type Transaction,
} from "@solana/kit";
import type { ClientConfig } from "../types.js";

export type SolanaCluster = "mainnet" | "devnet";

/**
 * The Solana sign/send surface the Wallet Standard wallet drives — byte-in/byte-out, so the provider
 * package never touches `@solana/kit`. It signs a dapp's serialized wire transaction with the wallet
 * key (via the connection's remote signer) and, for signAndSend, submits it.
 *
 * This rail does NOT front the dapp's transaction. Kora is designed to be integrated at BUILD time —
 * its documented flow sets the fee payer to Kora's signer from step one, because a fee payer cannot be
 * bolted onto a finished transaction. Rewriting a transaction a dapp already built and simulated, to
 * insert a fee payment and swap its fee payer, would be working against that design. Sponsoring therefore
 * lives on the own-origin `client.solana` rail, where Avok composes the instructions itself and can set
 * Kora as the fee payer from the start.
 *
 * What this rail does instead is honour the choice the DAPP made — see `signAndSend`.
 */
export interface SolanaEngine {
  /** The active Solana account (address + 32-byte public key), or null when logged out. */
  account(): { address: string; publicKey: Uint8Array } | null;
  /** Wallet Standard `solana:signMessage`. */
  signMessage(message: Uint8Array): Promise<{ signedMessage: Uint8Array; signature: Uint8Array }>;
  /** Wallet Standard `solana:signTransaction` — returns the signed wire transaction. */
  signTransaction(wireTx: Uint8Array, cluster: SolanaCluster): Promise<Uint8Array>;
  /** Wallet Standard `solana:signAndSendTransaction` — returns the 64-byte transaction signature. */
  signAndSend(wireTx: Uint8Array, cluster: SolanaCluster): Promise<Uint8Array>;
}

export function createSolanaEngine(config: ClientConfig): SolanaEngine {
  const { connection } = config;

  function requireAddress(): Address {
    const addr = connection.account()?.solana.address;
    if (!addr) throw new Error("no active Solana account");
    return addr as Address;
  }

  function resolveRpc(cluster: SolanaCluster): SolanaRpcClient {
    return config.deps?.solanaRpc ?? createSolanaRpcClient(solanaRpcUrl(cluster, config.rpcUrls));
  }

  function resolveKora(): KoraClient | undefined {
    if (config.deps?.kora) return config.deps.kora;
    if (!config.koraUrl) return undefined;
    const fetch = config.deps?.fetch ?? (globalThis.fetch.bind(globalThis) as never);
    return createKora({ url: config.koraUrl, fetch });
  }

  /** The fee payer is the first static account of a compiled message — position IS the role here. */
  function feePayerOf(tx: Transaction): string {
    const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    return compiled.staticAccounts[0] as string;
  }

  /** Decode the wire tx, sign its message bytes through the connection, and splice the signature in. */
  async function signWire(wireTx: Uint8Array, cluster: SolanaCluster): Promise<Transaction> {
    const address = requireAddress();
    const tx = getTransactionDecoder().decode(wireTx) as Transaction;
    const { signature } = await connection.signSolanaTransaction(tx.messageBytes as unknown as Uint8Array, { cluster });
    return { ...tx, signatures: { ...tx.signatures, [address]: base58.decode(signature) } } as Transaction;
  }

  return {
    account() {
      const address = connection.account()?.solana.address;
      return address ? { address, publicKey: base58.decode(address) } : null;
    },

    async signMessage(message) {
      const { signature } = await connection.signSolanaMessage(new TextDecoder().decode(message));
      return { signedMessage: message, signature: base58.decode(signature) };
    },

    async signTransaction(wireTx, cluster) {
      return getTransactionEncoder().encode(await signWire(wireTx, cluster)) as Uint8Array;
    },

    async signAndSend(wireTx, cluster) {
      const signed = await signWire(wireTx, cluster); // ONE gesture
      const base64 = getBase64EncodedWireTransaction(signed);

      // Route on the fee payer the DAPP chose, rather than rewriting its transaction.
      //
      //   the user   → self-pay: ours is the only required signature, so our RPC can broadcast it.
      //   anyone else → a Kora-aware dapp built this for its own fee payer, so we hold ONE of TWO
      //     required signatures. Broadcasting it ourselves would simply bounce for a missing
      //     signature; it has to go back to Kora, which co-signs as fee payer and submits.
      if (feePayerOf(signed) !== requireAddress()) {
        const kora = resolveKora();
        if (!kora) {
          throw new Error(
            "this transaction's fee payer is not the wallet, so the wallet cannot submit it — " +
              "configure koraUrl to let the fee payer co-sign and broadcast it",
          );
        }
        const { signature } = await kora.signAndSendTransaction(base64);
        return base58.decode(signature);
      }

      return base58.decode(await resolveRpc(cluster).sendTransaction(base64));
    },
  };
}
