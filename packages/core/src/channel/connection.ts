import type { Address, Hex, TransactionSerializable, TypedDataDefinition } from "viem";
import { saveAccount, loadAccount, clearAccount, memoryStorage } from "./storage.js";
import type { StorageAdapter } from "./storage.js";
import { createRemoteSigner } from "./signer.js";
import type { SigningChannel } from "./channels/port.js";
import { randomAuthorizeNonce, verifyAuthorizeProof } from "./authorize-proof.js";
import type { SharedAccount, Signer, SignedAuthorizationLike, SiweParams } from "./types.js";

// ---------------------------------------------------------------------------
// SharedOriginConnection — the public type produced by createSharedOriginConnection.
// The 5 Signer verbs plus a connect/account/status/logout lifecycle.
// ---------------------------------------------------------------------------
export type SharedOriginConnection = Signer & {
  /**
   * Open the auth-origin popup, let the user run the passkey ceremony there, and receive the
   * account it returns. Persisted via `storage`, so a reload does not re-prompt.
   *
   * There is no OIDC handshake left (#8): no PKCE, no `state`, no code to exchange, no token to
   * mint. The popup postMessages the account back over the channel, which already pins both the
   * origin it opened and the exact window it opened — the protections `state` and PKCE existed to
   * provide for a redirect through the address bar.
   */
  connect(): Promise<SharedAccount>;

  /** The connected account, in memory or restored from storage. Null when not connected. */
  account(): SharedAccount | null;

  /** True when an account is available (in-memory or persisted). */
  status(): boolean;

  /** Forget the account. There is no server to tell — nothing was ever stored there. */
  logout(): void;
};

// ---------------------------------------------------------------------------
// createSharedOriginConnection
// ---------------------------------------------------------------------------
export function createSharedOriginConnection(opts: {
  /** The operator's auth origin — the popup to open, and the ONLY origin whose replies are accepted. */
  authOrigin: string;
  channel: SigningChannel;
  storage?: StorageAdapter;
}): SharedOriginConnection {
  const storage = opts.storage ?? memoryStorage();
  const channel = opts.channel;
  // The origin the authorize proof is bound to — a signature from operator A must not verify at B.
  const authOrigin = opts.authOrigin;

  // In-memory cache — set by connect(), cleared by logout().
  let current: SharedAccount | null = null;

  function resolveAccount(): SharedAccount | null {
    return current ?? loadAccount(storage);
  }

  function requireAccount(): SharedAccount {
    const a = resolveAccount();
    if (!a) throw new Error("Not connected: call connect() first");
    return a;
  }

  // The remote signer is created per-call and carries the credentialId so the popup can constrain
  // the assertion to the passkey this account was established with (straight to biometrics, no
  // picker). That value used to ride the access token's claims.
  function getRemoteSigner(): Signer {
    const account = requireAccount();
    return createRemoteSigner({ channel, credentialId: account.credentialId });
  }

  return {
    async connect(): Promise<SharedAccount> {
      // Fresh per connect. A reused nonce is a replayable proof, which would defeat the point.
      const nonce = randomAuthorizeNonce();
      const result = await channel.open({ kind: "authorize", nonce });
      if (result.kind !== "authorize") {
        throw new Error(`Unexpected channel result kind: expected "authorize", got "${result.kind}"`);
      }
      const account = result.account;

      // VERIFY, do not trust. The address decides where a user believes their funds live, and on a
      // transport that answers over a callback URL nothing about the reply says who sent it. The
      // signature over our nonce is unforgeable without the wallet key, so it settles the question
      // regardless of how the reply travelled.
      //
      // Checked on EVERY transport, including the web popup where postMessage already proves the
      // origin. The channel is injectable, so the connection cannot know which guarantees the one it
      // was handed actually provides — and a check that only runs on the transports someone
      // remembered to weaken is not a check.
      const verified = await verifyAuthorizeProof({
        evmAddress: account.evmAddress,
        nonce,
        authOrigin,
        proof: result.proof,
      });
      if (!verified) {
        throw new Error(
          "Shared-origin authorization failed verification: the reply did not prove control of the " +
            "address it returned. Refusing to connect.",
        );
      }

      saveAccount(storage, account);
      current = account;
      return account;
    },

    async signMessage(args: { message: string }): Promise<Hex> {
      return getRemoteSigner().signMessage(args);
    },

    async signTypedData(args: TypedDataDefinition): Promise<Hex> {
      return getRemoteSigner().signTypedData(args);
    },

    async signSiwe(params: SiweParams): Promise<{ message: string; signature: Hex }> {
      return getRemoteSigner().signSiwe(params);
    },

    // Composite ops — one popup, one gesture. See Signer.signSend / Signer.signSponsored.
    async signSend(args) {
      return getRemoteSigner().signSend(args);
    },

    async signSponsored(args) {
      return getRemoteSigner().signSponsored(args);
    },

    async signUserOp(args) {
      return getRemoteSigner().signUserOp(args);
    },

    async signAuthorization(authorization: {
      chainId: number;
      address: Address;
      nonce: number;
    }): Promise<SignedAuthorizationLike> {
      return getRemoteSigner().signAuthorization(authorization);
    },

    async signTransaction(tx: TransactionSerializable): Promise<Hex> {
      return getRemoteSigner().signTransaction(tx);
    },

    async signSolanaTransaction(messageBytes: Uint8Array, opts?: { cluster?: string }) {
      return getRemoteSigner().signSolanaTransaction(messageBytes, opts);
    },

    async signSolanaMessage(message: string) {
      return getRemoteSigner().signSolanaMessage(message);
    },

    account(): SharedAccount | null {
      return resolveAccount();
    },

    status(): boolean {
      return resolveAccount() !== null;
    },

    logout(): void {
      current = null;
      clearAccount(storage);
    },
  };
}
