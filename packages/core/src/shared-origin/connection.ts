import { createSharedOriginConnection as createNetworkSharedOrigin } from "../channel/index.js";
import type { SigningChannel, StorageAdapter as NetStorage } from "../channel/index.js";
import type { Address, Hex } from "viem";
import type { Connection, Account } from "../types.js";

/**
 * createSharedOriginConnection wraps the channel's `createSharedOriginConnection` (`../channel`)
 * and adapts it to core's USE-ONLY `Connection` surface.
 *
 * Shared-origin connections are relying-party / use-only custody: they can authorize and
 * transact but MUST NOT expose custody-management verbs. `create`, `import`, `export`,
 * `addPasskey`, and access-slot writes are absent by design — management happens in the operator's
 * first-party own-origin app (see `ClientConfig.managementUrl`), never through the shared-origin app.
 *
 * Mapping:
 * - `continue()`                    → `net.authorize()`, then return `net.account()!`
 * - 7 signer verbs                  → delegate to `net`
 * - `account` / `status` / `logout` → delegate to `net`
 * - `custody`                       → "use-only"
 */
export function createSharedOriginConnection(opts: {
  /** The operator's auth origin — the popup to open, and the ONLY origin whose replies are trusted. */
  authOrigin: string;
  channel: SigningChannel;
  storage?: NetStorage;
}): Connection {
  const net = createNetworkSharedOrigin(opts);

  /**
   * Shapes the flat shared-origin session `{ evmAddress; solanaAddress }` (solanaAddress already known
   * present) into sdk-core's `Account = { evm; solana }`. Shared by the restore and authorize paths,
   * whose distinct null/throw guards on a missing `solanaAddress` run before calling this.
   *
   * No name is carried: the session has none. ENS and SNS are different namespaces and a user may
   * hold both, so a single field could never represent them — names are resolved at point of use,
   * exactly as own-origin does.
   */
  function shapeAccount(a: { evmAddress: Address; solanaAddress: string }): Account {
    return { evm: { address: a.evmAddress }, solana: { address: a.solanaAddress } };
  }

  const MISSING_SOLANA = "Shared-origin session is missing the solana_address claim (request the 'avok' scope)";

  /**
   * RESTORE path (`account()`), called on cold start against a session loaded from storage.
   *
   * A stored session missing `solanaAddress` is UNUSABLE but must not throw: `account()` runs at
   * provider mount, so throwing crashes the app before any UI — including `logout()` — renders,
   * leaving the user permanently stuck with no in-app way to recover. That is exactly what happens
   * to every existing session the first time an operator widens its granted scopes.
   *
   * So: drop it and report signed-out. `net.logout()` (not a bare `return null`) so the dead
   * session is cleared from storage and `status()` agrees — otherwise it is re-read and re-rejected
   * on every mount, and `status()` would keep claiming a session that `account()` denies.
   */
  function restoredAccount(): Account | null {
    const a = net.account();
    if (!a) return null;
    if (!a.solanaAddress) {
      // Drop the unusable session silently — no SDK console noise. logout() (not a bare return null)
      // clears it from storage so status() agrees and it is not re-read/re-rejected on every mount;
      // it self-heals on the next sign-in, which returns a session that carries the address.
      net.logout();
      return null;
    }
    return shapeAccount({ evmAddress: a.evmAddress, solanaAddress: a.solanaAddress });
  }

  /**
   * CONNECT path. Fail-loud here, unlike the restore path: an address missing from an account the
   * popup returned seconds ago is a live bug in the ceremony, not stale state. Clearing it would
   * mask that as an ordinary failed login. Never substitute an empty string or placeholder.
   *
   * (#8: this was `authorize()` and the missing-claim case was an OIDC scope misconfiguration —
   * `grantScopes()` narrowing the `avok` scope away silently. There are no scopes and no claims now;
   * the popup hands back the account it just read from the wallet.)
   */
  async function authorizeAndReturn(): Promise<Account> {
    await net.connect();
    const a = net.account();
    if (!a) throw new Error("authorize() succeeded but account() returned null");
    if (!a.solanaAddress) throw new Error(MISSING_SOLANA);
    return shapeAccount({ evmAddress: a.evmAddress, solanaAddress: a.solanaAddress });
  }

  return {
    custody: "use-only",

    /**
     * ONE POPUP, ONE GESTURE — the composite ops.
     *
     * Each signer verb is a round-trip to the network origin, and the origin runs a passkey ceremony
     * per request. So signing an undelegated send through the individual verbs meant TWO popups and
     * TWO biometric prompts for one "Send". A generic batch could not fix it either: the transaction
     * EMBEDS the signed authorization, so request 2 needs request 1's output.
     *
     * The origin's signer was already gesture-free (perform-sign.ts: "the caller performs the ONE
     * withDiscoveredKeys gesture"), so it signs both under the single gesture it already performs.
     */
    async signSend(args) {
      return net.signSend(args);
    },

    async signSponsored(args) {
      return net.signSponsored(args);
    },

    async signUserOp(args) {
      return net.signUserOp(args);
    },

    async continue(): Promise<Account> {
      return authorizeAndReturn();
    },

    async signMessage(args: { message: string }): Promise<Hex> {
      return net.signMessage(args);
    },

    async signTypedData(args): Promise<Hex> {
      return net.signTypedData(args);
    },

    async signSiwe(params): Promise<{ message: string; signature: Hex }> {
      return net.signSiwe(params);
    },

    async signAuthorization(authorization) {
      return net.signAuthorization(authorization);
    },

    async signTransaction(tx): Promise<Hex> {
      return net.signTransaction(tx);
    },

    async signSolanaTransaction(messageBytes: Uint8Array, opts?: { cluster?: string }) {
      return net.signSolanaTransaction(messageBytes, opts);
    },

    async signSolanaMessage(message: string) {
      return net.signSolanaMessage(message);
    },

    account(): Account | null {
      return restoredAccount();
    },

    status(): boolean {
      return net.status();
    },

    logout(): void {
      net.logout();
    },
  };
}
