import type { Address, Hex, TransactionSerializable, TypedDataDefinition } from "viem";
import type { Signer, AuthorizationTriple, SignedAuthorizationLike } from "./channel/index.js";
import type { EvmChainProfile, RpcClient, AvokUserOperation } from "./evm/index.js";
import type { FetchLike } from "./http.js";
import type { RpcOverrides } from "@avokjs/contracts";
import type { StorageAdapter } from "./storage.js";
import type { NonceAllocator } from "./nonce.js";

/**
 * Account represents a user's account address.
 *
 * NO NAME FIELD: a name is resolved data, not wallet state. An app that shows a name
 * resolves it via @avokjs/core/helpers `createNameResolver` and holds it in its own state.
 */
export type Account = {
  evm: { address: Address };
};

/**
 * CreateOpts configures the account creation ceremony.
 */
export type CreateOpts = {
  intentHint?: "create" | "continue";
};

/**
 * ContinueOpts configures the account recovery/continuation ceremony.
 */
export type ContinueOpts = {
  credentialId?: string;
};

/**
 * Connection is the ONE custody surface every app gets (D3: popup-for-all — there is no more
 * in-page own-origin custody posture, so there is no more custody split to type). The Signer verbs
 * plus continuation, logout, and state introspection: everything a dapp needs to authorize and
 * transact. Wallet lifecycle beyond that (create, guardians, recovery, devices) is the vault's own
 * surface, reached through its own protocol kinds (`channel/protocol.ts`), not through this type.
 */
export interface Connection extends Signer {
  /**
   * ONE USER ACTION = ONE PASSKEY GESTURE.
   *
   * A send from an UNDELEGATED wallet needs TWO signatures — the EIP-7702 authorization and the
   * transaction — and the transaction EMBEDS the signed authorization. Produced through the individual
   * signer verbs, each opened its own key scope: two biometric prompts (own-origin) or two popups
   * (shared-origin) for one "Send". Beyond the annoyance, that trains people to approve prompts
   * reflexively — the exact habit a malicious second prompt relies on.
   *
   * They cannot be a generic batch either: signature 2 needs signature 1's OUTPUT. Hence composite
   * verbs, one per real action, each a single gesture on BOTH rails.
   *
   * `tx` carries no authorizationList — the signer signs the authorization, embeds it, and signs the
   * transaction. Do all IO before calling: the key is live only for the duration.
   */
  signSend(args: { tx: TransactionSerializable; authorization?: AuthorizationTriple }): Promise<Hex>;

  /** ONE GESTURE. The sponsored batch signature and, if undelegated, its EIP-7702 authorization. */
  signSponsored(args: {
    typedData: TypedDataDefinition;
    authorization?: AuthorizationTriple;
  }): Promise<{ signature: Hex; authorization?: SignedAuthorizationLike }>;

  /**
   * ONE GESTURE — the 4337 sponsored send. Sign an (unsigned) v0.8 UserOperation's `userOpHash` (the raw
   * ecrecover signature the contract's `validateUserOp` checks) and, if the wallet is still
   * undelegated, the EIP-7702 authorization the same first send installs. The connection derives the
   * hash from `userOp` + `chainId` itself, so the signed digest always matches the fields the consent
   * surface shows. The returned `signature` goes into `userOp.signature`.
   */
  signUserOp(args: {
    userOp: AvokUserOperation;
    chainId: number;
    authorization?: AuthorizationTriple;
  }): Promise<{ signature: Hex; authorization?: SignedAuthorizationLike }>;

  /**
   * Continue an existing account (e.g., recovery). Returns the account address.
   */
  continue(opts?: ContinueOpts): Promise<Account>;

  /**
   * Logout and clear the connection state.
   */
  logout(): Promise<void> | void;

  /**
   * Get the current account, or null if no account is active.
   */
  account(): Account | null;

  /**
   * Check if the connection is in a valid state (e.g., has a signer/key available).
   */
  status(): boolean;
}

/**
 * ClientConfig holds the configuration for the SDK client.
 */
export interface ClientConfig<C extends Connection = Connection> {
  /**
   * The Connection instance managing account and signing operations.
   */
  connection: C;

  /** URL of the operator's wallet-management UI (settings, guardians, devices), surfaced to apps that
   *  want to link out to it. Optional — the vault itself is where these ceremonies actually run. */
  managementUrl?: string;

  /**
   * Optional URL of the ERC-7677 paymaster that sponsors sponsored (4337) sends. Sponsored requires BOTH
   * `paymasterUrl` and `bundlerUrl`; a send that asks for sponsorship on a chain missing either throws
   * `SponsorshipUnavailableError`. There is no degrade to native gas.
   */
  paymasterUrl?: string;

  /**
   * Optional URL of the ERC-4337 bundler that submits sponsored UserOperations (bring-your-own; may equal
   * `paymasterUrl` for providers like Pimlico/Alchemy). Without it there is no sponsored rail — see
   * `paymasterUrl`.
   */
  bundlerUrl?: string;

  /**
   * RPC endpoints, per chain. Avok ships NO third-party provider as a default: an RPC is a trust
   * boundary (it answers "what address does `vitalik.eth` resolve to?", and a liar there redirects
   * the user's funds), so the integrator picks who they trust.
   *
   * Unset chains fall back to the registry's PUBLIC endpoint, which is DEVELOPMENT-ONLY — public
   * endpoints are rate-limited, carry no SLA, and block the indexed reads a wallet needs.
   *
   * Three ways to set this, none of which require Avok to run anything:
   *   - your own provider URL (a domain-allowlisted key is safe in a browser bundle — it is useless
   *     from any other origin, so a serverless app needs no backend);
   *   - a proxy you host — including the Avok operator's, which keeps the provider key server-side;
   *   - a URL your END USER supplies, the way many wallets expose a custom-RPC field.
   *
   * @example
   * rpcUrls: {
   *   evm: { 8453: "https://base-mainnet.example.com/v2/..." },
   * }
   */
  rpcUrls?: RpcOverrides;

  /**
   * Optional storage adapter for persisting non-secret state (e.g., session metadata).
   */
  storage?: StorageAdapter;

  /**
   * Intent-nonce allocator. Defaults to random 256-bit nonces (stateless, L2-friendly). Pass
   * `createSequentialNonceAllocator(storage)` on L1 / expensive-storage deployments to CLUSTER nonces
   * into the contract's bitmap words (~4× cheaper repeat writes, 256× denser storage). See nonce.ts.
   */
  nonceAllocator?: NonceAllocator;

  /**
   * Deadline window for sponsored batch signatures (seconds). Defaults to 3600 (one hour).
   */
  defaultDeadlineSeconds?: number;

  /** @internal Test injection seam — do not use in application code. */
  deps?: {
    rpc?: RpcClient;
    fetch?: FetchLike;
    /** Override the 4337 bundler client (sponsored). */
    bundler?: import("./evm/index.js").Bundler;
    /** Override the ERC-7677 paymaster client (sponsored). */
    paymaster?: import("./evm/index.js").Paymaster7677;
    /** Override the chain profile (e.g., to set a non-zero canonicalImplementation in tests). */
    chain?: EvmChainProfile;
  };
}
