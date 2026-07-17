import type { ClientConfig } from "@avokjs/sdk-core";
import { createSendEngine, type SendEngine } from "@avokjs/sdk-core/internal";
import type { Receipt } from "@avokjs/txengine";
import { dispatch, chainIdHex, accountsOf, type ProviderRuntime } from "./eip1193-methods.js";

/** The EIP-1193 provider object viem/wagmi/ethers consume. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

export interface Eip1193Options {
  /** The chain reported by `eth_chainId` until `wallet_switchEthereumChain` moves it. Defaults to 1. */
  defaultChainId?: number;
  /**
   * The client's reactive seam. The facade passes `client.subscribe` so the provider emits
   * `connect`/`disconnect`/`accountsChanged` off the same state store the client fans out from.
   */
  subscribe?: (listener: () => void) => () => void;
  /** Test/advanced seam: override the send engine (defaults to `createSendEngine(config)`). */
  engine?: SendEngine;
}

/**
 * Wrap an Avok `ClientConfig` in an EIP-1193 provider. Per the wallet-SDK norm (Privy/Coinbase/WC),
 * the provider closes over the whole engine, not a bare connection: `config.connection` is the signer,
 * and the rest of `config` supplies RPC/chain/gas for sending (wired in Tasks 3–4).
 */
export function createEip1193Provider(config: ClientConfig, opts: Eip1193Options = {}): Eip1193Provider {
  let chainId = opts.defaultChainId ?? 1;

  // A tiny typed event registry — the EIP-1193 event surface (connect/disconnect/accountsChanged/chainChanged).
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  function emit(event: string, ...args: unknown[]): void {
    const set = listeners.get(event);
    if (!set) return;
    for (const l of [...set]) l(...args);
  }

  const rt: ProviderRuntime = {
    connection: config.connection,
    engine: opts.engine ?? createSendEngine(config),
    calls: new Map<string, Receipt>(),
    getChainId: () => chainId,
    setChainId: (id: number) => {
      chainId = id;
    },
    emit,
  };

  // Derive EIP-1193 events from the client's reactive state. `connect`/`disconnect` is the dapp↔wallet
  // relationship (distinct from the owner's login session, per SPEC §2); accountsChanged carries the roster.
  let prevConnected = config.connection.status() && config.connection.account() !== null;
  let prevAddr = config.connection.account()?.evm.address ?? null;
  opts.subscribe?.(() => {
    const nowConnected = config.connection.status() && config.connection.account() !== null;
    const nowAddr = config.connection.account()?.evm.address ?? null;
    if (nowConnected && !prevConnected) emit("connect", { chainId: chainIdHex(chainId) });
    if (!nowConnected && prevConnected) emit("disconnect");
    if (nowAddr !== prevAddr) emit("accountsChanged", accountsOf(rt));
    prevConnected = nowConnected;
    prevAddr = nowAddr;
  });

  return {
    request: ({ method, params }) => dispatch(rt, method, params ?? []),
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
    },
  };
}
