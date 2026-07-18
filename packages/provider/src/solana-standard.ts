import { registerWallet } from "@wallet-standard/wallet";
import type { Wallet, WalletAccount, WalletIcon } from "@wallet-standard/base";
import type { ClientConfig } from "@avokjs/sdk-core";
import { createSolanaEngine, type SolanaEngine, type SolanaCluster } from "@avokjs/sdk-core/internal";

const SOLANA_CHAINS = ["solana:mainnet", "solana:devnet"] as const;
const ACCOUNT_FEATURES = ["solana:signMessage", "solana:signTransaction", "solana:signAndSendTransaction"] as const;
// Legacy + v0 versioned transactions.
const SUPPORTED_TX_VERSIONS = ["legacy", 0] as const;
const ICON: WalletIcon = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";

export interface SolanaStandardOptions {
  /** Test/advanced seam: override the Solana engine (defaults to `createSolanaEngine(config)`). */
  engine?: SolanaEngine;
  /** The client's reactive seam; the facade passes `client.subscribe` so `standard:events` fires on login/logout. */
  subscribe?: (listener: () => void) => () => void;
}

/** `"solana:devnet"` → `"devnet"`. Defaults to mainnet when the chain is absent/unknown. */
function toCluster(chain: string | undefined): SolanaCluster {
  return chain === "solana:devnet" ? "devnet" : "mainnet";
}

/**
 * Register an Avok wallet on the Solana Wallet Standard so `@solana/wallet-adapter` reaches it with no
 * Avok import. The features delegate to the Solana engine (byte-in/byte-out). Returns an unregister
 * disposer.
 *
 * Sending here submits the transaction the DAPP built: self-pay when the dapp made the user its fee
 * payer, and handed back to Kora when the dapp built for a Kora fee payer of its own (the engine routes
 * on that — see `createSolanaEngine`). The wallet never rewrites a dapp's transaction to front it; Kora
 * is integrated at build time, so Avok's own sponsoring lives on the own-origin `client.solana` rail.
 *
 * Note there is no fee-token capability to expose here: unlike EIP-5792's `paymasterService`, the Solana
 * Wallet Standard has no slot through which a dapp could name one.
 */
export function registerAvokSolanaWallet(config: ClientConfig, opts: SolanaStandardOptions = {}): () => void {
  const engine = opts.engine ?? createSolanaEngine(config);
  const changeListeners = new Set<(props: { accounts: readonly WalletAccount[] }) => void>();

  function accounts(): readonly WalletAccount[] {
    const info = engine.account();
    if (!info) return [];
    return [
      {
        address: info.address,
        publicKey: info.publicKey,
        chains: SOLANA_CHAINS,
        features: ACCOUNT_FEATURES,
      },
    ];
  }

  const wallet: Wallet = {
    version: "1.0.0",
    name: "Avok",
    icon: ICON,
    chains: SOLANA_CHAINS,
    get accounts() {
      return accounts();
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => ({ accounts: accounts() }),
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {},
      },
      "standard:events": {
        version: "1.0.0",
        on: (event: string, listener: (props: { accounts: readonly WalletAccount[] }) => void) => {
          if (event !== "change") return () => {};
          changeListeners.add(listener);
          return () => changeListeners.delete(listener);
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: (...inputs: { account: WalletAccount; message: Uint8Array }[]) =>
          Promise.all(inputs.map((i) => engine.signMessage(i.message))),
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: SUPPORTED_TX_VERSIONS,
        signTransaction: (...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]) =>
          Promise.all(
            inputs.map(async (i) => ({ signedTransaction: await engine.signTransaction(i.transaction, toCluster(i.chain)) })),
          ),
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: SUPPORTED_TX_VERSIONS,
        signAndSendTransaction: (...inputs: { account: WalletAccount; transaction: Uint8Array; chain: string }[]) =>
          Promise.all(inputs.map(async (i) => ({ signature: await engine.signAndSend(i.transaction, toCluster(i.chain)) }))),
      },
    },
  };

  const unsubscribe = opts.subscribe?.(() => {
    const next = accounts();
    for (const l of [...changeListeners]) l({ accounts: next });
  });

  registerWallet(wallet);
  return () => {
    unsubscribe?.();
    changeListeners.clear();
  };
}
