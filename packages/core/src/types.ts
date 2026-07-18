import type { Address, Hex, TransactionSerializable, TypedDataDefinition } from "viem";
import type { Signer, AuthorizationTriple, SignedAuthorizationLike } from "./channel/index.js";
import type { ExportedWallet, VaultReader, AccessSlotEntry } from "./wallet/index.js";
import type { Call, RpcClient, FetchLike, EvmChainProfile, AvokUserOperation } from "./evm/index.js";
import type { RpcOverrides } from "@avokjs/contracts";
import type { StorageAdapter } from "./storage.js";
import type { NonceAllocator } from "./nonce.js";

/**
 * Account represents a user's account address on both rails.
 *
 * NO NAME FIELD: a subname is add-on data, not wallet state (#6). An app that shows a name
 * resolves it via @avokjs/helpers `createNameResolver` and holds it in its own state.
 */
export type Account = {
  evm: { address: Address };
  solana: { address: string };
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

/** Capabilities the client lends to a connection's access-slot ceremony. */
export interface AccessCtx {
  /** Submit calls through the client's send path; returns at least a tx id. */
  submit(calls: Call[], opts: { chainId: number }): Promise<{ id: string }>;
  /** Whether a specific access slot is already stored on a chain (idempotency check). */
  hasSlot(slotId: Hex, chainId: number): Promise<boolean>;
  /**
   * THE PRECONDITION THAT PREVENTS ORPHANS. Throw if the wallet cannot afford to write an access slot on this
   * chain. Called BEFORE any credential is minted — creation and the write can never be atomic, so a
   * credential minted into a write the user cannot pay for is an orphan by construction.
   *
   * It simulates a representative access-slot write (which resolves the EIP-7702 authorization for an
   * undelegated wallet, exactly as the real send does) and compares the cost, plus a buffer, against
   * the balance that will actually pay: native gas in self-pay, the fee token in sponsored mode. The
   * buffer means the threshold is deliberately ABOVE the true cost — it is a gate, not a quote.
   */
  assertCanAffordAccessSlot(chainId: number): Promise<void>;

  /**
   * THE ACCESS-SLOT WRITER — one user action, ONE passkey gesture.
   *
   * An access-slot write needs the wallet key TWICE: to seal the blob, and to sign the transaction carrying
   * it. Two primitives meant two key scopes, so ONE "add this device" asked for TWO biometric
   * confirmations. It cannot just be wrapped in a single scope: the sealed blob determines the
   * calldata, the calldata determines the transaction, and building the transaction needs chain IO —
   * and K must never be live across a network round-trip.
   *
   * So it is split in three. The middle phase is the ONLY one that holds the key, and it does no IO:
   *
   *   prepare()   → IO, no key   — resolve nonce/delegation/fee from a same-sized PROBE call
   *   sign()      → key, no IO   — seal AND sign, inside the caller's single scope
   *   broadcast() → IO, no key
   *
   * The probe is exact, not an approximation: the access-slot-write calldata is a FIXED length, because
   * BLOB_BYTES (61) and META_BYTES (93) are constants (the metadata is zero-padded to a constant
   * precisely so its size leaks nothing).
   *
   * `prepared` and `signed` are OPAQUE handles — pass them back unchanged.
   */
  prepareWrite(probe: Call[], chainId: number): Promise<unknown>;
  /** PURE. Must be called INSIDE a single key scope, with that scope's signer. Never does IO. */
  signWrite(prepared: unknown, calls: Call[], signer: ScopedSigner): Promise<unknown>;
  broadcastWrite(prepared: unknown, signed: unknown): Promise<{ id: string }>;
}

/**
 * The EVM signature verbs over a key scope the caller ALREADY opened — calling them opens no further
 * passkey gesture. Used by `AccessCtx.signWrite`, which runs inside the access-slot writer's single scope.
 * Solana is absent on purpose — its rail signs a single payload, so it never needed collapsing.
 */
export type ScopedSigner = Pick<
  Signer,
  "signMessage" | "signTypedData" | "signSiwe" | "signAuthorization" | "signTransaction"
>;

/**
 * Connection is the USE-ONLY custody surface: the Signer verbs plus continuation,
 * logout, and state introspection — everything a relying-party (shared-origin) app needs
 * to authorize and transact, but NOT to manage custody.
 *
 * The 7 Signer verbs (signMessage, signTypedData, signSiwe, signAuthorization,
 * signTransaction, signSolanaTransaction, signSolanaMessage) are inherited.
 *
 * Custody-management verbs (create, export, addPasskey) live only on
 * `SelfCustodyConnection` (own-origin, self-custody). Shared-origin connections are `Connection`
 * and MUST NOT expose them — the boundary is enforced at the type level.
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

  /** Custody posture. "self" (own-origin) exposes management; "use-only" (shared-origin) does not. */
  readonly custody: "self" | "use-only";
}

/**
 * SelfCustodyConnection is the OWN-ORIGIN (self-custody) surface: `Connection` plus the
 * custody-management verbs. Only own-origin connections implement it; shared-origin (use-only)
 * connections are plain `Connection` and never carry these members.
 */
export interface SelfCustodyConnection extends Connection {
  readonly custody: "self";

  /**
   * Whether this connection supports key export.
   */
  readonly canExport: boolean;

  /**
   * Create a new account. Returns the account address.
   */
  create(opts?: CreateOpts): Promise<Account>;

  /**
   * Export the connection's FULL key material so the user can back up the whole wallet, not just
   * one chain. Returns `{ evm, solana }`: two raw private keys, never a 24-word phrase. No standard
   * derivation path reproduces the HKDF chain, so a phrase would look restorable and restore nothing.
   * A dual-chain wallet must never surface only the EVM key (that would silently strand Solana funds).
   */
  export(): Promise<ExportedWallet>;

  /**
   * Enroll a new passkey as a SECONDARY device AND write its PRF-encrypted blob to the wallet's
   * on-chain access-slot storage, atomically. A secondary cannot derive K (its PRF differs from the
   * primary's), so its recovery depends on that ciphertext being on chain — enrolment and the write
   * are one funded transaction (submitted via `ctx.submit`), never split, so no half-enrolled "dead
   * device" is ever reachable. Handles only ciphertext; no plaintext key is produced. Idempotent:
   * returns `txId: "noop"` when the slot is already stored.
   */
  addPasskey(ctx: AccessCtx): Promise<{ slotId: Hex; txId: string; passkeyCount: number }>;

  /** The roster a settings screen needs: every access slot on the anchor chain WITH the domain that
   *  enrolled it, each with its enrollment date and an `isThisDevice` flag. There is no cross-chain
   *  index (§3.5), so this lists the anchor chain only; a credential with no slot never appears.
   *  Requires one passkey ceremony (the metadata is encrypted under the wallet key, decrypted only in
   *  the sandbox). `rpId: null` = absent or unreadable metadata; render "unknown domain", never an error.
   *
   *  THIS IS THE TRUST SURFACE: every domain listed can reach the wallet key. */
  listAccessSlots(): Promise<(AccessSlotEntry & { rpId: string | null })[]>;

  /** REMOVE an access slot and free it. Housekeeping, NOT a security control — it cannot un-learn a key
   *  the passkey already used, and the blob remains in the chain's history. `confirm: true` is required
   *  (the same explicit gate export uses) so an access slot cannot be closed by accident. If a device is
   *  compromised, MOVE THE FUNDS; removing its access slot is not a substitute. See buildRemoveAccessSlotCall. */
  removeAccessSlot(ctx: AccessCtx, slotId: Hex, opts: { confirm: true }): Promise<{ txId: string }>;

  /** Local credentials known to this session. NOT an access-slot count: a credential whose slot write never
   *  landed (an ORPHAN) is counted here and opens nothing. Never render this as "ways into your
   *  wallet" — use accessSlotCount(), which is verified against the chain. */
  passkeyCount(): number;

  /** The chain-verified number of access slots in this wallet. THIS is the number behind "you have N ways
   *  into this wallet"; neither an orphan nor a PENDING access slot is one of them. */
  accessSlotCount(): Promise<number>;



  /**
   * PASSKEY ENROLMENT (Own-origin-only) — the one ceremony, three QR codes.
   *
   * It provisions an access slot for a new credential. The credential may be on the user's own second
   * device or under a COMPLETELY INDEPENDENT DOMAIN — the ceremony is the same and the passkey it produces
   * is the same passkey, because on chain they are indistinguishable. That is what stops a wallet being
   * hostage to one domain: an independent domain can hold a passkey, and it needs NO chain access to get
   * one (no RPC, no gas, no paymaster, no delegation).
   *
   * THE WALLET KEY NEVER TRAVELS. The enrolling credential derives its own wrapping key from its own
   * PRF and sends that; the holder seals K under it and pays for the write. (The old ceremony shipped K
   * to the new device; it is deleted.)
   *
   *  - `holder` runs on the EXISTING, live wallet: authorize → complete.
   *  - `enroller` runs on the new device/domain: begin → receiveAck → enroll, then `continue()` to log
   *    in once the holder's write has landed. It cannot log in before that: what it decrypts is its
   *    blob, and the blob is not on chain until the holder puts it there.
   *
   * ENROLLING A PASSKEY IS A GRANT, DEFERRED. Once the slot lands, that credential can decrypt its way to
   * K whenever it likes — any passkey that can recover the wallet can obtain the key. No UI may claim
   * otherwise; `listAccessSlots` + `readAccessSlotRpId` are what let a user see and prune the domains that
   * hold their key.
   */
  pairing: {
    /** The EXISTING wallet: it has K, it is delegated, and it pays for the write. */
    holder: {
      /** Answer the enroller's request. The ack carries the sealed offer (wallet + anchor chain) the
       *  enroller needs before it can mint a credential. Returns the SAS for the user to compare.
       *
       *  Takes `ctx` to PREFLIGHT the write path: the enroller has no chain access and is about to mint
       *  a credential purely on the strength of this ack, so if our write path is dead we refuse HERE —
       *  before a passkey exists on their domain that we could never finish enrolling. Throws
       *  EnrolmentBlockedError; nothing is created. */
      authorize(args: { qr: string; ctx: AccessCtx }): Promise<{ qr: string; sas: string }>;
      /** Open the wrap, seal K under the received wrapping key, write the slot, pay. The slot id is
       *  derived here from the credential id — never taken off the wire. `sasConfirmed` MUST be true:
       *  a MITM that substituted its own wrapping key would get a passkey into this wallet. Idempotent on
       *  a retry of the same credential. */
      complete(args: { qr: string; sasConfirmed: true; ctx: AccessCtx }): Promise<{ slotId: Hex; txId: string }>;
    };
    /** The NEW device or domain: no wallet, no chain access, and it never receives K. */
    enroller: {
      begin(): Promise<{ qr: string }>;
      receiveAck(qr: string): Promise<{ sas: string }>;
      /** Mint this origin's credential and return its wrapping key, sealed. `sasConfirmed` MUST be
       *  true — the wrapping key plus the public blob yields K, so an unconfirmed channel is a stolen
       *  wallet. Afterwards, wait for the holder's write and call `continue()`. */
      enroll(args: { sasConfirmed: true }): Promise<{ qr: string; rpId: string }>;
      /**
       * REPAIR an orphaned credential — one that exists and whose slot write never landed (see
       * OrphanedCredentialError). Identical to `enroll` except that it REUSES the credential instead of
       * minting one, reproducing the same wrapping key the failed enrolment would have used.
       *
       * Repair needs a SURVIVING PASSKEY and there is no way around that: this credential holds a PRF but
       * no key, so with no passkey left to re-encrypt from, the wallet is gone. Say that plainly rather
       * than offering a repair that cannot work.
       */
      repair(args: { sasConfirmed: true }): Promise<{ qr: string; rpId: string }>;
    };
  };
}

/**
 * ClientConfig holds the configuration for the SDK client.
 */
export interface ClientConfig<C extends Connection = Connection> {
  /**
   * The Connection instance managing account and signing operations.
   */
  connection: C;

  /** Operator's first-party own-origin app URL for management (surfaced to shared-origin apps). */
  managementUrl?: string;

  /**
   * Optional URL of the ERC-7677 paymaster that sponsors sponsored (4337) sends. Sponsored requires BOTH
   * `paymasterUrl` and `bundlerUrl`; a chain missing either falls back to self-pay.
   */
  paymasterUrl?: string;

  /**
   * Optional URL of the ERC-4337 bundler that submits sponsored UserOperations (bring-your-own; may equal
   * `paymasterUrl` for providers like Pimlico/Alchemy). Without it, sponsored falls back to self-pay.
   */
  bundlerUrl?: string;

  /**
   * RPC endpoints, per chain. Avok ships NO third-party provider as a default: an RPC is a trust
   * boundary (it answers "what address does `vitalik.eth` resolve to?", and a liar there redirects
   * the user's funds), so the integrator picks who they trust.
   *
   * Unset chains fall back to the registry's PUBLIC endpoint, which is DEVELOPMENT-ONLY — public
   * endpoints are rate-limited, carry no SLA, and block the indexed reads a wallet needs (the public
   * Solana endpoints 403 or hang on `getTokenAccountsByOwner`, so SPL balances silently read 0).
   *
   * Three ways to set this, none of which require Avok to run anything:
   *   - your own provider URL (a domain-allowlisted key is safe in a browser bundle — it is useless
   *     from any other origin, so a serverless app needs no backend);
   *   - a proxy you host — including the Avok operator's, which keeps the provider key server-side;
   *   - a URL your END USER supplies, the way Jupiter and Solflare expose a custom-RPC field.
   *
   * @example
   * rpcUrls: {
   *   solana: { mainnet: "https://mainnet.helius-rpc.com/?api-key=..." },
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

  /**
   * Optional URL of the Kora node that sponsors Solana sends (bring-your-own). Kora is BOTH the fee payer
   * and the submitter, so this single endpoint is the Solana analogue of `paymasterUrl` + `bundlerUrl`
   * together. Without it, Solana sends fall back to self-pay.
   *
   * There is deliberately no default: a fee payer is a trust boundary — it sees, prices, and can refuse
   * every transaction you send — so the integrator picks who they trust, the same posture as `rpcUrls`.
   */
  koraUrl?: string;

  /** @internal Test injection seam — do not use in application code. */
  deps?: {
    rpc?: RpcClient;
    vaultReader?: VaultReader;
    fetch?: FetchLike;
    /** Override the 4337 bundler client (sponsored). */
    bundler?: import("./evm/index.js").Bundler;
    /** Override the ERC-7677 paymaster client (sponsored). */
    paymaster?: import("./evm/index.js").Paymaster7677;
    /** Override the chain profile (e.g., to set a non-zero canonicalImplementation in tests). */
    chain?: EvmChainProfile;
    /** Override the Solana RPC client (e.g., to inject a fake in tests). */
    solanaRpc?: import("./solana/index.js").SolanaRpcClient;
    /** Override the Kora client (Solana sponsored). */
    kora?: import("./solana/index.js").KoraClient;
  };
}
