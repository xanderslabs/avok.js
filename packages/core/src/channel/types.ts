import type { Address, Hex, TransactionSerializable, TypedDataDefinition } from "viem";
import type { UserOperation } from "viem/account-abstraction";
import type { SiweMessage } from "viem/siwe";

// ---------------------------------------------------------------------------
// SIWE — minimal param shape (mirrors the wallet module's SiweParams without the dep)
// SiweParams omits `address` because the signer fills it in from the wallet key.
// ---------------------------------------------------------------------------
export type SiweParams = Omit<SiweMessage, "address">;

/** The ERC-4337 EntryPoint versions Avok's sponsored rail can target — mirrors
 *  `evm/entrypoint.ts`'s `AvokEntryPointVersion` (duplicated, not imported: `channel/` has no
 *  dependency on `evm/`, and this union is a stable wire-protocol primitive, not internal plumbing). */
export type EntryPointVersion = "0.8" | "0.9";

// ---------------------------------------------------------------------------
// SignedAuthorizationLike — matches viem's SignedAuthorization shape.
// Defined locally so the client package does not re-export viem's internal
// conditional type, which carries generic parameters consumers don't need.
// ---------------------------------------------------------------------------
export type SignedAuthorizationLike = {
  address: Address;
  chainId: number;
  nonce: number;
  r: Hex;
  s: Hex;
  yParity: number;
};

// ---------------------------------------------------------------------------
// Signer — the 5 signing verbs the client exposes (mirrors the wallet module's
// signing surface + viem account ops).
//
// signTypedData receives the full TypedDataDefinition (same shape the wallet module
// and the origin server use — domain + types + primaryType + message).
// ---------------------------------------------------------------------------
export interface Signer {
  /** EIP-191 personal-sign. */
  signMessage(args: { message: string }): Promise<Hex>;

  /** EIP-712 typed-data signature. */
  signTypedData(args: TypedDataDefinition): Promise<Hex>;

  /**
   * EIP-4361 SIWE: builds the canonical message for the wallet address, then
   * personal-signs it.  Returns both the formatted message and signature so
   * the caller can forward both to the server without re-deriving the message.
   */
  signSiwe(params: SiweParams): Promise<{ message: string; signature: Hex }>;

  /**
   * ONE GESTURE. Sign a native-gas transaction and, if the wallet is still undelegated, the EIP-7702
   * authorization it must carry — the transaction embeds the signed authorization, so the two cannot
   * be independent requests. Returns the serialized transaction.
   */
  signSend(args: { tx: TransactionSerializable; authorization?: AuthorizationTriple }): Promise<Hex>;

  /** ONE GESTURE. Sign a sponsored batch and, if undelegated, its EIP-7702 authorization. */
  signSponsored(args: {
    typedData: TypedDataDefinition;
    authorization?: AuthorizationTriple;
  }): Promise<{ signature: Hex; authorization?: SignedAuthorizationLike }>;

  /**
   * ONE GESTURE — the 4337 sponsored analogue of `signSponsored`. Sign a UserOperation (the origin
   * recomputes its EIP-712 `userOpHash` from these same fields, so what the user is shown and what is
   * signed cannot drift) and, if the wallet is still undelegated, its EIP-7702 authorization. The
   * `userOp` is UNSIGNED here; the returned `signature` goes into `userOp.signature`.
   */
  signUserOp(args: {
    userOp: UserOperation<EntryPointVersion>;
    chainId: number;
    /** Which EntryPoint version to recompute the userOpHash against — must match what the target
     *  wallet's `ENTRY_POINT()` actually trusts, or the recomputed hash (and the resulting signature)
     *  is for the wrong EntryPoint. */
    entryPointVersion: EntryPointVersion;
    authorization?: AuthorizationTriple;
  }): Promise<{ signature: Hex; authorization?: SignedAuthorizationLike }>;

  /**
   * EIP-7702 authorization signing.  The authorization triple is
   * `{ chainId, address, nonce }` — the signer fills in the signature fields.
   */
  signAuthorization(authorization: {
    chainId: number;
    address: Address;
    nonce: number;
  }): Promise<SignedAuthorizationLike>;

  /** Sign and serialize a transaction.  Returns the hex-encoded signed tx. */
  signTransaction(tx: TransactionSerializable): Promise<Hex>;
}

// ---------------------------------------------------------------------------
// SignRequest — discriminated union mirroring the origin's /sign endpoint.
// ---------------------------------------------------------------------------
/** The unsigned EIP-7702 authorization triple. */
export type AuthorizationTriple = { chainId: number; address: Address; nonce: number };

export type SignRequest =
  | { op: "signMessage"; message: string }
  | { op: "signTypedData"; typedData: TypedDataDefinition }
  | { op: "signSiwe"; params: SiweParams }
  | { op: "signAuthorization"; authorization: { chainId: number; address: Address; nonce: number } }
  | { op: "signTransaction"; tx: TransactionSerializable }
  // ── COMPOSITE OPS — one request, ONE passkey gesture at the origin ──────────────────────────────
  // An undelegated wallet's send needs TWO signatures, and the second EMBEDS the first: the
  // transaction carries the signed 7702 authorization in its authorizationList. So they cannot be
  // sent as two independent requests (each would be its own popup + its own biometric prompt), and
  // they cannot be a generic "array of ops" batch either — request 2 needs request 1's OUTPUT.
  // Hence a composite: the origin signs the authorization, embeds it, and signs the transaction,
  // all under the single gesture it already performs.
  | { op: "signSend"; tx: TransactionSerializable; authorization?: AuthorizationTriple }
  | { op: "signSponsored"; typedData: TypedDataDefinition; authorization?: AuthorizationTriple }
  | {
      op: "signUserOp";
      userOp: UserOperation<EntryPointVersion>;
      chainId: number;
      entryPointVersion: EntryPointVersion;
      authorization?: AuthorizationTriple;
    };

// ---------------------------------------------------------------------------
// SignResult — union of all possible sign responses.
// `consent` is typed `unknown` here: the client forwards the server's opaque
// consent payload without inspecting it.
// ---------------------------------------------------------------------------
export type SignResult =
  | { signature: Hex }
  /** signSponsored — the batch signature plus, when undelegated, the signed 7702 authorization. */
  | { signature: Hex; authorization?: SignedAuthorizationLike }
  | { signature: Hex; consent: unknown }
  | { message: string; signature: Hex }
  | SignedAuthorizationLike
  | Hex
  // The popup can REFUSE, and that refusal must be part of the type. It was not: the popup has
  // always posted { error: "user_rejected" } on Reject, the union never admitted it, and the signer
  // cast it straight through as if it were a signature — so a rejected sign resolved with
  // `signature === undefined` instead of throwing. See classifySignError().
  | { error: string };

// ---------------------------------------------------------------------------
// SharedAccount — what the auth-popup returns after the passkey ceremony. No tokens.
// ---------------------------------------------------------------------------
/**
 * The shared-origin account — Own-origin's WalletState in transit. Note the naming: `evmAddress`,
 * matching WalletState, never `address`. No name field: a name is resolved data, not wallet state,
 * so it is resolved at the point of use.
 *
 * There are no tokens: there is no session to hold, and the address needs no proof. A hostile
 * popup could only make a dapp DISPLAY a wrong address — it cannot sign, because every action needs
 * a passkey gesture on the real origin and the signature verifies against the real key. What is left
 * is public, which is why the app can simply hold it.
 */
export type SharedAccount = {
  evmAddress: Address;
  /** The smart wallet this device's key signs FOR — coincides with `evmAddress` for the founding
   *  device and differs for every device enrolled later (WalletState's doc, `wallet/sandbox.ts`).
   *  Optional so a session persisted before this field existed still restores (falls back to
   *  `evmAddress`, the founding-device behavior every such session actually has). */
  walletAddress?: Address;
  /** The passkey this account was established with — lets the sign popup skip the account picker
   *  and go straight to biometrics. Dropping it re-prompts on every signature; see ChannelRequest. */
  credentialId?: string;
};
