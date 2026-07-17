import { withSolanaKey, type PasskeyAdapter, type WalletState } from "@avokjs/wallet-core";
import type { Address, SignatureDictionary, Transaction, TransactionPartialSigner } from "@solana/kit";

/** Wrap S-1's withSolanaKey as a kit partial signer: one passkey gesture signs all provided txs' message bytes. */
export function toKitSigner(args: {
  state: WalletState;
  passkey: PasskeyAdapter;
  credentialId?: string;
}): TransactionPartialSigner {
  const address = args.state.solanaAddress as Address;
  return {
    address,
    async signTransactions(transactions: readonly Transaction[]): Promise<readonly SignatureDictionary[]> {
      return withSolanaKey(args, async (solanaSigner) => {
        const out: SignatureDictionary[] = [];
        for (const tx of transactions) {
          const signature = await solanaSigner.sign(tx.messageBytes as unknown as Uint8Array);
          out.push({ [address]: signature } as unknown as SignatureDictionary);
        }
        return out;
      });
    },
  };
}

/** Shared-origin sibling of toKitSigner: a kit partial signer whose signing goes over the tunnel.
 *  `sign` is wired to network's signSolanaTransaction (base58→bytes decoded at the boundary). */
export function toRemoteKitSigner(args: {
  address: Address;
  sign: (messageBytes: Uint8Array) => Promise<Uint8Array>;
}): TransactionPartialSigner {
  return {
    address: args.address,
    async signTransactions(transactions: readonly Transaction[]): Promise<readonly SignatureDictionary[]> {
      const out: SignatureDictionary[] = [];
      for (const tx of transactions) {
        const signature = await args.sign(tx.messageBytes as unknown as Uint8Array);
        out.push({ [args.address]: signature } as unknown as SignatureDictionary);
      }
      return out;
    },
  };
}
