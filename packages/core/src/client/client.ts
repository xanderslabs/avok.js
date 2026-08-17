import { isDelegatedTo } from "../evm/index.js";
import { evmRpcUrl } from "@avokjs/contracts";
import { resolveChainId, requireChain, makeViemRpc } from "./evm.js";
import type { ClientConfig, Account, ContinueOpts, Connection } from "../types.js";

export type { TxOpts } from "./evm.js";

/**
 * AvokClient is the surface every client exposes. There is no more custody split (D3: popup-for-all —
 * every app gets the same posture): wallet lifecycle beyond login (create, guardians, recovery,
 * devices) is the vault's own surface, reached through its own protocol kinds, not through this
 * client.
 */
export interface AvokClient {
  /** Log in to an existing account (passkey recovery / resume). */
  login(o?: ContinueOpts): Promise<Account>;
  account(): Account | null;
  status(): boolean;
  logout(): Promise<void> | void;
  /**
   * Subscribe to client state changes. The listener fires after any verb that can change
   * `account()` / `status()` (login / logout). Returns an unsubscribe function. This is the seam
   * the React/RN providers observe — they no longer patch the client object.
   */
  subscribe(listener: () => void): () => void;
  /** Whether the account is EIP-7702-activated (delegated to the wallet impl) on `chainId`. */
  isActivated(chainId: number): Promise<boolean>;
}

export function createAvokClient<C extends Connection>(config: ClientConfig<C>): AvokClient {
  const { connection, deps } = config;

  // State-change fan-out. Fired after any verb that can move account()/status().
  const listeners = new Set<() => void>();
  function notify(): void {
    for (const listener of listeners) listener();
  }

  return {
    async login(o) {
      const a = await connection.continue(o);
      notify();
      return a;
    },
    logout() {
      const r = connection.logout();
      if (r && typeof (r as Promise<void>).then === "function") {
        return (r as Promise<void>).then(() => {
          notify();
        });
      }
      notify();
      return r;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    account: () => connection.account(),
    status: () => connection.status(),

    async isActivated(chainId: number): Promise<boolean> {
      const id = resolveChainId(chainId); // throws "chainId is required" if omitted
      const chain = requireChain(config, id); // single call; resolves deps.chain override if set
      const address = connection.account()?.evm.address;
      if (!address) return false;
      // Inline rpc resolution using the already-resolved chain profile (avoids a second getChainProfile).
      const rpc = deps?.rpc ?? makeViemRpc(evmRpcUrl(id, config.rpcUrls));
      const code = await rpc.getCode(address);
      return isDelegatedTo(code, chain.canonicalImplementation);
    },
  };
}
