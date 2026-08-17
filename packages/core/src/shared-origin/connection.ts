import { createSharedOriginConnection as createChannelSharedOrigin } from "../channel/index.js";
import type { SigningChannel, StorageAdapter as ChannelStorage } from "../channel/index.js";
import type { Address, Hex } from "viem";
import type { Connection, Account } from "../types.js";

/**
 * createSharedOriginConnection wraps the channel's `createSharedOriginConnection` (`../channel`)
 * and adapts it to core's `Connection` surface — the one custody posture every app gets (D3:
 * popup-for-all). Wallet lifecycle beyond login (create, guardians, recovery, devices) is the vault's
 * own surface, reached through its own protocol kinds, never through this connection.
 *
 * Mapping:
 * - `continue()`                    → `net.authorize()`, then return `net.account()!`
 * - 7 signer verbs                  → delegate to `net`
 * - `account` / `status` / `logout` → delegate to `net`
 */
export function createSharedOriginConnection(opts: {
  /** The operator's auth origin — the popup to open, and the ONLY origin whose replies are trusted. */
  originPoint: string;
  channel: SigningChannel;
  storage?: ChannelStorage;
}): Connection {
  const net = createChannelSharedOrigin(opts);

  /**
   * Shapes the flat shared-origin session `{ evmAddress }` into core's `Account = { evm }`. Shared by
   * the restore and authorize paths.
   *
   * No name is carried: the session has none. A name is resolved data, not wallet state, so it is
   * resolved at the point of use, exactly as own-origin does.
   */
  function shapeAccount(a: { evmAddress: Address }): Account {
    return { evm: { address: a.evmAddress } };
  }

  /** Storage holds whatever a previous version wrote, so a restored session is UNTRUSTED input. */
  function hasAddress(a: unknown): a is { evmAddress: Address } {
    return typeof (a as { evmAddress?: unknown } | null)?.evmAddress === "string";
  }

  /**
   * RESTORE path (`account()`), called on cold start against a session loaded from storage.
   *
   * An unusable stored session is DROPPED, never thrown on. `account()` runs at provider mount, so a
   * throw crashes the app before any UI renders, including `logout()`, stranding the user with no
   * in-app way to recover. Returning null is always recoverable: the next sign-in replaces it.
   *
   * And it must be dropped rather than passed through. `loadAccount` only guarantees the bytes
   * parsed as JSON, so `{}`, `[]` and `"a string"` all reach here; shaping one of those yields an
   * account whose address is `undefined` while `status()` reports SIGNED IN. That is the worst of
   * the three outcomes, because the app renders as connected against something it cannot use.
   *
   * `net.logout()` rather than a bare `return null`, so the dead session leaves storage and
   * `status()` agrees. Otherwise it is re-read and re-rejected on every mount.
   */
  function restoredAccount(): Account | null {
    const a = net.account();
    if (!a) return null;
    if (!hasAddress(a)) {
      net.logout();
      return null;
    }
    return shapeAccount({ evmAddress: a.evmAddress });
  }

  /**
   * CONNECT path. Fail-loud, unlike the restore path: an account the popup returned seconds ago
   * coming back absent or malformed is a live bug in the ceremony, not stale state. Clearing it
   * would disguise that as an ordinary failed sign-in. Never substitute a placeholder.
   */
  async function authorizeAndReturn(): Promise<Account> {
    await net.connect();
    const a = net.account();
    if (!a) throw new Error("authorize() succeeded but account() returned null");
    if (!hasAddress(a)) throw new Error("authorize() returned an account with no evmAddress");
    return shapeAccount({ evmAddress: a.evmAddress });
  }

  return {
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
