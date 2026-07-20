import {
  createWallet,
  exportWallet,
  reconstructFromKey,
  reconstructWalletState,
  addPasskey,
  resolveBlob,
  deriveWalletKey,
  decodeUserHandle,
  withWalletKey,
  withWalletKeyAndContainer,
  withSolanaKey,
  withDecryptedContainer,
  generateEphemeral,
  randomNonce,
  buildInvite,
  encodePayload,
  decodePayload,
  deriveSession,
  base64UrlToBytes,
  signMessage as wcSignMessage,
  signTypedData as wcSignTypedData,
  signSiwe as wcSignSiwe,
  deriveSlotId,
  serializeBlob,
  BLOB_BYTES,
  META_BYTES,
  buildAddAccessSlotCall,
  buildRemoveAccessSlotCall,
  listAccessSlots as coreListAccessSlots,
  readAccessSlotRpId,
  vaultForChainFromRegistry,
  createPasskeyCredential,
  repairPasskeyCredential,
  sealWrap,
  openWrap,
  type PendingAccessSlotWrap,
  sealAccessSlot,
  type AccessSlotOffer,
  type AccessSlotWrap,
  type WalletState,
  type PasskeyAdapter,
  type VaultReader,
  type RosterReader,
  type AccessSlotEntry,
  type PairEphemeral,
  type PairInvite,
  type ExportedWallet,
} from "../wallet/index.js";
import type { SecretContainer } from "../wallet/crypto/container.js";
import { createSiweMessage } from "viem/siwe";
import { base58 } from "@scure/base";
import { encodeOffchainMessage } from "../solana/index.js";
import { getAvokUserOpHash, type AvokUserOperation } from "../evm/index.js";
import { resolveAnchorChain, getChainProfile, DEFAULT_ANCHOR_CHAIN_ID, type ChainId } from "@avokjs/contracts";
import {
  type Address,
  type Hex,
  type TypedDataDefinition,
  type TransactionSerializable,
  type PrivateKeyAccount,
} from "viem";
import type { SiweParams, SignedAuthorizationLike, AuthorizationTriple } from "../channel/index.js";
import type { SelfCustodyConnection, Account, AccessCtx, ScopedSigner } from "../types.js";
import type { StorageAdapter } from "../storage.js";

/** A secondary credential's blob lives on chain. If we cannot read it, the wallet is fine and the
 *  network is not — never conflate the two. This is distinct from "no wallet found": a secondary
 *  whose vault read fails is unreachable, not gone, and the caller should retry, not despair. */
export class SlotUnreachableError extends Error {
  constructor() {
    super("Could not reach the access-slot chain to unlock this device. Check your connection and retry.");
    this.name = "SlotUnreachableError";
  }
}

/**
 * This credential was never finished enrolling. The passkey exists — it is in the picker, it has a
 * friendly name — and the chain, asked and answering, has no access slot for it. It opens nothing.
 *
 * It is NOT retryable and must never be presented as such: no amount of waiting writes a slot that was
 * never written. (Before this existed, an orphan surfaced as SlotUnreachableError — "check your
 * connection and retry" — which is advice that can never succeed.)
 *
 * It IS repairable, through a passkey that still works, and ONLY through one: this credential holds a PRF
 * but no key, so with no surviving passkey there is nothing left to re-encrypt and the wallet is gone. Say
 * that plainly rather than offering a repair that cannot work.
 */
export class OrphanedCredentialError extends Error {
  constructor(
    readonly credentialId: string,
    readonly address: Address,
    readonly anchorChain: number,
  ) {
    // The message names the STATE, not a guessed cause — because a single read genuinely cannot tell
    // "never written" from "written, still being mined". Both are "no access slot on chain right now", and
    // they have different remedies, so the user is told both. What it must never do is blame the
    // network: that is the lie that sent people into an infinite retry loop.
    super(
      "No access slot for this passkey is on chain. If you just set this device up, the other device may still be finishing — check it, then try once more. If that enrolment was interrupted, this passkey must be repaired from a device that still works; retrying alone will never create an access slot.",
    );
    this.name = "OrphanedCredentialError";
  }
}

/**
 * The wallet cannot pay to write an access slot. Thrown BEFORE any credential is minted, which is the whole
 * point: creation and the write can never be atomic, so a passkey minted into a write the user cannot
 * afford is an ORPHAN by construction. Refuse to start what cannot finish.
 *
 * `required` is a GATE, not a quote — it carries a buffer over the simulated cost, deliberately.
 * `token: null` means native gas (self-pay); otherwise it is the fee token (sponsored mode).
 */
export class EnrolmentUnaffordableError extends Error {
  readonly chainId: number;
  readonly token: Address | null;
  readonly required: bigint;
  readonly balance: bigint;
  constructor(args: { chainId: number; token: Address | null; required: bigint; balance: bigint }) {
    super(
      `Not enough funds to add a device to this wallet. It needs about ${args.required} ${args.token ? "of the fee token" : "wei"} on chain ${args.chainId}, and has ${args.balance}. Top the wallet up and try again — nothing was created.`,
    );
    this.name = "EnrolmentUnaffordableError";
    this.chainId = args.chainId;
    this.token = args.token;
    this.required = args.required;
    this.balance = args.balance;
  }
}

/** We could not complete this enrolment, so we did not begin it. Nothing was created and nothing needs
 *  cleaning up — contrast OrphanedCredentialError, which is the state this exists to prevent. */
export class EnrolmentBlockedError extends Error {
  constructor(cause?: unknown) {
    super("Cannot enrol a passkey right now: the access-slot chain is not reachable. Nothing was created — try again.");
    this.name = "EnrolmentBlockedError";
    this.cause = cause;
  }
}

/**
 * A stand-in access-slot write, used to resolve the chain BEFORE the wallet key is live. It is exact, not an
 * approximation: `BLOB_BYTES` (61) and `META_BYTES` (93) are constants — the access-slot metadata is
 * zero-padded to a fixed length precisely so its ciphertext size leaks nothing — so this call has the
 * same calldata length as the real one, and therefore resolves to the same nonce, delegation and fee.
 * The bytes are non-zero to match real ciphertext's calldata gas (16/byte, not 4).
 */
function accessSlotWriteProbe(address: Address, slotId: Hex) {
  return buildAddAccessSlotCall({
    address,
    slotId,
    encryptedBlob: new Uint8Array(BLOB_BYTES).fill(0xab),
    encryptedMeta: new Uint8Array(META_BYTES).fill(0xcd),
  });
}

/** The EVM signer verbs over an account ALREADY unlocked inside a key scope — no further gesture. */
function scopedSigner(account: PrivateKeyAccount, st: WalletState): ScopedSigner {
  return {
    signMessage: (args) => account.signMessage(args),
    signTypedData: (args) => account.signTypedData(args),
    signSiwe: async (params) => {
      const message = createSiweMessage({ ...params, address: st.evmAddress });
      return { message, signature: await account.signMessage({ message }) };
    },
    // Cast is safe: viem returns { ...fields, v } (legacy); SignedAuthorizationLike omits v.
    signAuthorization: (auth) => account.signAuthorization(auth) as Promise<SignedAuthorizationLike>,
    signTransaction: (tx) => account.signTransaction(tx),
    // The hash is derived HERE from the operation rather than accepted from the caller, so this is a
    // UserOperation signer and not a general signing oracle over the wallet key.
    signUserOp: ({ userOp, chainId }) => account.sign({ hash: getAvokUserOpHash(userOp, chainId) }),
  };
}

export function createOwnOriginConnection(opts: {
  rpId: string;
  passkey: PasskeyAdapter;
  /** Cosmetic friendly operator name. Prefixes the passkey wallet LABEL
   *  ("<operatorName> Wallet · Nickname"); defaults to `rpId` when unset. The WebAuthn `rp.name`
   *  (the "Sign in to …" the OS shows) is set on the passkey adapter by the platform wrapper, not
   *  here. This is a DISPLAY string only — it never touches the rpId, the PRF scope, or key material. */
  operatorName?: string;
  storage?: StorageAdapter;
  anchorVault?: VaultReader;
  /** Per-chain vault resolver. Reads follow the secondary's handle MARKER, not this app's configured
   *  anchor, so a credential enrolled by a sibling app (same rpId, different anchor) still resolves
   *  its blob from the chain that holds it. When omitted, `anchorVault` (single override) or a
   *  registry-RPC reader for the marker chain is used. Primarily a test seam for cross-app scenarios. */
  vaultForChain?: (chainId: number) => VaultReader;
  anchorChainId?: ChainId;
}): SelfCustodyConnection & { passkeyCount(): number } {
  const anchorChainId: ChainId = opts.anchorChainId ?? DEFAULT_ANCHOR_CHAIN_ID;
  // The WRITE anchor: the single EVM chain THIS app stores NEW secondaries on. Recorded per-credential
  // in the handle (encodeAccessHandle) so reads follow the marker, not this config.
  const anchorChain = resolveAnchorChain(anchorChainId); // throws fail-loud on non-EVM/unknown
  // Resolve the access vault for the chain a SECONDARY's handle points at. A primary never calls this
  // — it derives K from its own PRF. Precedence: an explicit per-chain resolver, then a single
  // injected reader (test/custom RPC), then a registry-RPC reader for the marker chain. Fail loud if
  // the marker names a chain absent from the registry: a wrong-chain reader would silently return
  // not-found and look like "your wallet is gone" when it is merely anchored elsewhere.
  function vaultForChain(chainId: number): VaultReader {
    if (opts.vaultForChain) return opts.vaultForChain(chainId);
    if (opts.anchorVault) return opts.anchorVault;
    // Unknown marker chain: we have no RPC to read its blob. Fail loud as a retryable
    // SlotUnreachableError — a wrong-chain reader would silently return not-found and look like
    // "your wallet is gone" when it is merely anchored to a chain absent from this build's registry.
    if (!getChainProfile(chainId)) throw new SlotUnreachableError();
    return vaultForChainFromRegistry(chainId);
  }
  // Roster reads (list a wallet's access slots). A test may inject a roster-capable reader via
  // opts.vaultForChain/anchorVault; otherwise the registry reader — which implements RosterReader —
  // is the real one.
  function rosterForChain(chainId: number): RosterReader {
    const injected = opts.vaultForChain?.(chainId) ?? opts.anchorVault;
    if (injected && "getAccessSlotIds" in injected) return injected as unknown as RosterReader;
    if (!getChainProfile(chainId)) throw new SlotUnreachableError();
    return vaultForChainFromRegistry(chainId);
  }
  let state: WalletState | null = null;
  // Per-session ephemeral pairing state. Wiped on completion/abort; never persisted.
  // Per-session ephemeral enrolment state. Wiped on completion/abort; never persisted. `offer` is the
  // holder's wallet+chain, learned by the enroller from the ack, and needed before it can mint.
  let pairing: {
    role: "A" | "B";
    eph: PairEphemeral;
    nonce: string;
    key?: CryptoKey;
    offer?: AccessSlotOffer;
    /** HOLDER only: the decrypted-but-withheld wrap, awaiting the user's SAS answer. */
    pending?: PendingAccessSlotWrap;
  } | null = null;

  /**
   * PREFLIGHT. Every orphan is born the same way: a credential minted into a write that was never going
   * to land. Creation and the write can never be atomic — the passkey must exist before its slot id can
   * be computed — but we can refuse to START what we can already see will not FINISH.
   *
   * The probe is a read of a slot that does not exist. What matters is not the answer but WHETHER WE GET
   * ONE: a chain that answers "no access slot here" is healthy (a brand-new, undelegated wallet answers exactly
   * that, and must still be able to enrol); a chain that throws is one we cannot write to either.
   *
   * It cannot be perfect — the chain can die between this check and the write — which is why repair
   * exists. It removes the PREDICTABLE orphans, which is most of them.
   */
  async function preflight(ctx: AccessCtx, feeToken?: Address | null): Promise<void> {
    // (1) Does the chain ANSWER? The zero slot id is a well-formed bytes32 no real credential can derive
    //     to; we are not asking about an access slot, we are asking whether the chain is reachable at all.
    const PROBE_SLOT = `0x${"00".repeat(32)}` as Hex;
    try {
      await ctx.hasSlot(PROBE_SLOT, anchorChain.chainId);
    } catch (e) {
      throw new EnrolmentBlockedError(e);
    }
    // (2) Can the wallet PAY for the access slot? This throws EnrolmentUnaffordableError, which is actionable
    //     ("top up") rather than mysterious. It propagates unchanged — wrapping it in
    //     EnrolmentBlockedError would throw away the numbers the user needs.
    await ctx.assertCanAffordAccessSlot(anchorChain.chainId, feeToken ?? null);
  }

  /** Access slots on THIS app's anchor chain (there is no cross-chain index — §3.5). The session's own
   *  credential marks the current device so a UI can guard against self-lockout. Read from the CHAIN:
   *  a credential that exists but has no slot is not an access slot, and never appears here. */
  async function enumerateAccessSlots(): Promise<AccessSlotEntry[]> {
    const st = requireState();
    return coreListAccessSlots({
      address: st.evmAddress,
      reader: rosterForChain(anchorChain.chainId),
      thisCredentialId: st.slots[0]?.credentialId,
    });
  }

  function requireState(): WalletState {
    if (!state) throw new Error("No wallet active — call create() or continue() first");
    return state;
  }

  return {
    custody: "self",
    canExport: true,

    async create(): Promise<Account> {
      const { account, state: st } = await createWallet({
        passkey: opts.passkey,
        networkName: opts.operatorName ?? opts.rpId,
      });
      state = st;
      return { evm: { address: account.evm }, solana: { address: account.solana } };
    },

    async export(): Promise<ExportedWallet> {
      const st = requireState();
      // Full material: { evm, solana } raw keys. Never narrow to the EVM key alone — the Solana
      // address IS the ed25519 pubkey of K, so dropping that key strands the Solana funds.
      return exportWallet({ state: st, passkey: opts.passkey, confirmExport: true });
    },

    async continue(): Promise<Account> {
      // One discoverable assertion returns the credential id, the user handle and the PRF output
      // together. The handle's kind byte picks the path.
      const discovered = await opts.passkey.discover();
      const handle = decodeUserHandle(discovered.userHandle);

      if (handle.kind === "primary") {
        // The passkey IS the wallet: K = HKDF(PRF), derived fresh. No chain read, no vault, no fee,
        // no network — logging out and back in works offline on every provider. The discovered
        // credential becomes the local slot so subsequent signing can re-authenticate it.
        const base = reconstructFromKey(await deriveWalletKey(discovered.prfOutput));
        state = {
          ...base,
          slots: [{ credentialId: discovered.credentialId, rpId: opts.rpId, createdAt: new Date().toISOString() }],
        };
        return { evm: { address: state.evmAddress }, solana: { address: state.solanaAddress } };
      }

      // Secondary: its blob lives on the chain recorded in ITS handle (the marker), which may differ
      // from this app's configured anchor when a sibling app sharing the rpId enrolled it. Resolve the
      // vault from that marker chain, not `anchorChain`. An unknown marker chain fails loud HERE
      // (outside the try) — that is a config/registry gap, not a network blip. An unreadable but known
      // vault is a NETWORK problem — the wallet is fine — so never report it as "no wallet found";
      // both the read failing and returning nothing are retryable unreachable-blob conditions.
      const anchorVault = vaultForChain(handle.anchorChain);
      let result: Awaited<ReturnType<typeof resolveBlob>>;
      try {
        result = await resolveBlob({
          address: handle.evm,
          credentialId: discovered.credentialId,
          anchorVault,
        });
      } catch {
        // The chain did not answer. The wallet is fine; the network is not. Retryable.
        throw new SlotUnreachableError();
      }
      if (!result) {
        // The chain ANSWERED, and has no access slot for this credential. That is not a network condition and
        // retrying is futile: the passkey was minted and its slot write never landed. Fail loud, and
        // differently — a repair through a surviving passkey is the only way back.
        throw new OrphanedCredentialError(discovered.credentialId, handle.evm, handle.anchorChain);
      }

      // The blob no longer carries its addresses; reconstruct decrypts it under this credential's PRF
      // and derives them, re-supplying what the blob dropped (address from the handle, credentialId
      // from discover(), this app's rpId). handle is narrowed to a secondary here.
      state = await reconstructWalletState({
        blob: result.blob,
        address: handle.evm,
        credentialId: discovered.credentialId,
        rpId: opts.rpId,
        prfOutput: discovered.prfOutput,
      });
      return { evm: { address: state.evmAddress }, solana: { address: state.solanaAddress } };
    },

    async logout(): Promise<void> {
      state = null;
    },

    account(): Account | null {
      if (!state) return null;
      return { evm: { address: state.evmAddress }, solana: { address: state.solanaAddress } };
    },

    status(): boolean {
      return state !== null;
    },

    async signMessage(args: { message: string }): Promise<Hex> {
      return wcSignMessage({ state: requireState(), passkey: opts.passkey, message: args.message });
    },

    async signTypedData(args: TypedDataDefinition): Promise<Hex> {
      return wcSignTypedData({ state: requireState(), passkey: opts.passkey, typedData: args });
    },

    async signSiwe(params: SiweParams): Promise<{ message: string; signature: Hex }> {
      return wcSignSiwe({ state: requireState(), passkey: opts.passkey, params });
    },

    async signAuthorization(auth: {
      chainId: number;
      address: `0x${string}`;
      nonce: number;
    }): Promise<SignedAuthorizationLike> {
      // Cast is safe: viem returns { ...fields, v } (legacy field); SignedAuthorizationLike omits v, which callers never read.
      return withWalletKey({ state: requireState(), passkey: opts.passkey }, (acct) =>
        acct.signAuthorization(auth),
      ) as Promise<SignedAuthorizationLike>;
    },

    async signTransaction(tx: TransactionSerializable): Promise<Hex> {
      return withWalletKey({ state: requireState(), passkey: opts.passkey }, (acct) => acct.signTransaction(tx));
    },

    /**
     * ONE gesture. An undelegated wallet's send needs the 7702 authorization AND the transaction, and
     * the transaction embeds the signed authorization — through the individual verbs that was two key
     * scopes, so one "Send" asked for two biometric confirmations. Here the key is unlocked once.
     */
    async signSend(args: { tx: TransactionSerializable; authorization?: AuthorizationTriple }): Promise<Hex> {
      return withWalletKey({ state: requireState(), passkey: opts.passkey }, async (acct) => {
        if (!args.authorization) return acct.signTransaction(args.tx);
        const signedAuth = await acct.signAuthorization(args.authorization);
        // Cast: TransactionSerializable is a discriminated union and spreading into it widens past
        // viem's OneOf<> guard. The shape is the eip7702 variant by construction.
        return acct.signTransaction({
          ...args.tx,
          type: "eip7702",
          authorizationList: [signedAuth],
        } as unknown as TransactionSerializable);
      });
    },

    /** ONE gesture: the sponsored batch signature and, if undelegated, its 7702 authorization. */
    async signSponsored(args: {
      typedData: TypedDataDefinition;
      authorization?: AuthorizationTriple;
    }): Promise<{ signature: Hex; authorization?: SignedAuthorizationLike }> {
      return withWalletKey({ state: requireState(), passkey: opts.passkey }, async (acct) => {
        const authorization = args.authorization
          ? ((await acct.signAuthorization(args.authorization)) as SignedAuthorizationLike)
          : undefined;
        const signature = await acct.signTypedData(args.typedData);
        return { signature, ...(authorization ? { authorization } : {}) };
      });
    },

    /** ONE gesture: the 4337 UserOp signature (raw ecrecover over the userOpHash) and, if undelegated,
     *  its 7702 authorization. The hash is auth-independent (viem v0.8), so it is derived here from the
     *  op + chainId and signed RAW — no EIP-191/712 wrapping — since it already IS the EIP-712 digest
     *  `validateUserOp` checks. */
    async signUserOp(args: {
      userOp: AvokUserOperation;
      chainId: number;
      authorization?: AuthorizationTriple;
    }): Promise<{ signature: Hex; authorization?: SignedAuthorizationLike }> {
      return withWalletKey({ state: requireState(), passkey: opts.passkey }, async (acct) => {
        const authorization = args.authorization
          ? ((await acct.signAuthorization(args.authorization)) as SignedAuthorizationLike)
          : undefined;
        const signature = await acct.sign({ hash: getAvokUserOpHash(args.userOp, args.chainId) });
        return { signature, ...(authorization ? { authorization } : {}) };
      });
    },

    // The `_signOpts` (cluster hint) is accepted for interface parity with the shared-origin
    // connection but ignored here: an own-origin signer decodes/renders consent locally in-app,
    // so no cluster needs to cross a channel boundary.
    async signSolanaTransaction(messageBytes: Uint8Array, _signOpts?: { cluster?: string }) {
      const sig = await withSolanaKey({ state: requireState(), passkey: opts.passkey }, (s) => s.sign(messageBytes));
      return { signature: base58.encode(sig), consent: undefined };
    },

    async signSolanaMessage(message: string) {
      const sig = await withSolanaKey({ state: requireState(), passkey: opts.passkey }, (s) =>
        s.sign(encodeOffchainMessage({ message, rpId: opts.rpId })),
      );
      return { signature: base58.encode(sig) };
    },

    passkeyCount(): number {
      return state?.slots.length ?? 0;
    },

    /**
     * PASSKEY ENROLMENT — the one ceremony, three codes.
     *
     *   enroller.begin()      -> request QR   (shown by the side getting a passkey)
     *   holder.authorize(qr)  -> ack QR + SAS (the ack carries the sealed offer: wallet + chain)
     *   enroller.receiveAck() -> SAS          (the human compares the 6 digits on both screens)
     *   enroller.enroll()     -> wrap QR      (mints the credential; sends W, never asking for K)
     *   holder.complete(qr)   -> writes the slot on chain, and PAYS for it
     *   ...then the new side calls continue() to log in, like any secondary.
     *
     * The wallet key never travels. The enrolling side needs NO chain access to enrol — no RPC, no
     * gas, no paymaster, no delegation — which is what lets an INDEPENDENT DOMAIN hold a passkey, so a
     * wallet is not hostage to one domain's survival.
     *
     * It is the same ceremony whether the new credential is on the user's own second device or under
     * someone else's domain, because the passkey it produces is the same passkey. Enrolling one is a GRANT,
     * deferred: that credential can decrypt its way to K whenever it likes once the slot lands. The
     * roster is what makes the set of domains holding your key visible and prunable.
     */
    pairing: {
      // ── The holder: an existing, live passkey. It has K, it is delegated, it pays. ──
      holder: {
        /**
         * ROUND 1 — the INVITE. The holder speaks first, because the enroller cannot act until it knows which
         * wallet it is enrolling into — that is baked into its credential's user handle at creation
         * and immutable afterwards.
         *
         * No SAS is returned yet: the digits commit to BOTH public keys, and the enroller's has not
         * arrived. It comes back from `receiveWrap`.
         */
        async invite(args: { ctx: AccessCtx }): Promise<{ qr: string }> {
          const st = requireState();
          // PREFLIGHT, and it belongs HERE. The enroller has no chain access by design — it cannot
          // check anything itself, and it is about to mint a credential purely on the strength of
          // this offer. If our write path is dead, say so now, before a passkey exists on their
          // domain that we could never finish enrolling.
          await preflight(args.ctx);
          const eph = generateEphemeral();
          const nonce = randomNonce();
          pairing = { role: "A", eph, nonce };
          return {
            qr: encodePayload(buildInvite(eph, nonce, { evm: st.evmAddress, anchorChainId: anchorChain.chainId })),
          };
        },

        /**
         * ROUND 2 arrives. Derive the session, DECRYPT the wrap, and show the user the digits.
         *
         * The wrapping key is inside what we just decrypted and is deliberately NOT reachable here —
         * `openWrap` hands back a gate, and only `complete({ sasConfirmed: true })` opens it. That
         * ordering is the entire reason this ceremony can be two rounds instead of three: W may
         * arrive before the human confirms, because W alone is worthless. It is worth something only
         * once we seal K under it and publish the blob, and that happens on the far side of the gate.
         */
        async receiveWrap(qr: string): Promise<{ sas: string }> {
          const st = requireState();
          if (!pairing || pairing.role !== "A") throw new Error("no enrolment session — call invite() first");
          const wrap = decodePayload<AccessSlotWrap>(qr, "wrap");
          const { key, sas } = await deriveSession({
            myPrivate: pairing.eph.privateKey,
            myPublic: pairing.eph.publicKey,
            theirPublic: base64UrlToBytes(wrap.bPub),
            iAmEnroller: false,
            nonce: pairing.nonce,
            offer: { evm: st.evmAddress, anchorChainId: anchorChain.chainId },
          });
          pairing.key = key;
          pairing.pending = await openWrap(key, wrap);
          return { sas };
        },

        /**
         * ROUND 2 is already in hand; this is the human's answer to it.
         *
         * The SAS interlock is not written here. `receiveWrap` decrypted into a gate, and the only
         * route to a wrapping key is `confirm(sasConfirmed)` — so the check cannot be dropped by a
         * refactor of this function, and any future caller inherits it instead of remembering it.
         *
         * Refusing wipes the wrapping key. The enroller must then BURN its credential and mint a
         * fresh one before retrying: W is scoped to (address, slotId) and slotId derives from the
         * credential id, so reusing it would make an attacker's copy of W live the instant a later
         * attempt publishes the blob.
         */
        async complete(args: { sasConfirmed: true; ctx: AccessCtx }): Promise<{ slotId: Hex; txId: string }> {
          const st = requireState();
          if (!pairing || pairing.role !== "A" || !pairing.pending)
            throw new Error("no enrolment session — call invite() then receiveWrap() first");
          const wrap = pairing.pending.confirm(args.sasConfirmed);
          pairing = null;

          // The slot id is derived from the CREDENTIAL ID, not taken off the wire — a hostile enroller
          // cannot aim the write at an access slot it did not create. It needs no key, so the idempotency check
          // and the whole chain resolve happen before the passkey is ever touched.
          const slotId = deriveSlotId(st.evmAddress, wrap.credentialId);
          if (await args.ctx.hasSlot(slotId, anchorChain.chainId)) {
            return { slotId, txId: "noop" };
          }

          // ONE GESTURE. Phase 1 — resolve the write with NO key, against a probe of the exact same
          // shape (BLOB_BYTES and META_BYTES are constants, so the calldata length is identical).
          const prepared = await args.ctx.prepareWrite(
            [accessSlotWriteProbe(st.evmAddress, slotId)],
            anchorChain.chainId,
          );

          // Phase 2 — the ONLY phase holding K, and it does no IO: seal the blob under K and sign the
          // transaction that carries it, inside a SINGLE passkey scope. Sealing and signing used to be
          // two separate primitives, so enrolling one device asked the user to confirm twice.
          const { slotId: sealedSlotId, signed } = await withWalletKeyAndContainer(
            { state: st, passkey: opts.passkey },
            async ({ container, account }) => {
              const sealed = await sealAccessSlot({ container, evm: st.evmAddress, ...wrap });
              const call = buildAddAccessSlotCall({
                address: st.evmAddress,
                slotId: sealed.slotId,
                encryptedBlob: serializeBlob(sealed.blob),
                encryptedMeta: sealed.encryptedMeta,
              });
              const signed = await args.ctx.signWrite(prepared, [call], scopedSigner(account, st));
              return { slotId: sealed.slotId, signed };
            },
          );

          // Phase 3 — IO again, key gone. No queue, no "pending": the write either lands or the whole
          // enrolment fails loudly. The affordability precondition ran in authorize() BEFORE the
          // enroller minted its credential, so a failure here is a genuine fault (the chain died
          // mid-ceremony), not the predictable no-funds case — and repair exists for that residue.
          const receipt = await args.ctx.broadcastWrite(prepared, signed);
          return { slotId: sealedSlotId, txId: receipt.id };
        },
      },

      // ── The enroller: a fresh device, or an independent domain. No wallet, no chain access. ──
      enroller: {
        /**
         * The WHOLE enroller side, in one call — and the name says what it costs: this MINTS A PASSKEY.
         * Read the invite, create the credential, seal its wrapping key, answer.
         *
         * Three verbs collapsed into this because the two rounds the ceremony used to spend agreeing
         * on a session are now folded into the two rounds that carry real payload. Nothing was
         * skipped: the offer is read, an ephemeral is generated, ECDH runs, and the digits are
         * computed — it simply all happens between receiving one code and sending the next.
         *
         * The SAS is returned ALONGSIDE the wrap rather than gating it, and that inversion is the
         * heart of the reduction. W is not a secret worth a round of its own: W plus the on-chain
         * blob yields K, and W alone yields nothing. An attacker who intercepts this wrap holds a key
         * to a lock that will never be built, because the holder compares digits before publishing
         * the blob and abandons the ceremony on a mismatch.
         *
         * ON MISMATCH THIS CREDENTIAL IS BURNED. Never call this twice and reuse a credential: W is
         * scoped to (address, slotId) and slotId derives from the credential id, so an attacker's
         * copy of W would come alive the moment a later attempt published a blob for the same
         * credential. Every call mints a fresh one, which is what makes that safe by construction.
         */
        async mintAndWrap(qr: string): Promise<{ qr: string; sas: string; rpId: string }> {
          const invite = decodePayload<PairInvite>(qr, "invite");
          const eph = generateEphemeral();
          const { key, sas } = await deriveSession({
            myPrivate: eph.privateKey,
            myPublic: eph.publicKey,
            theirPublic: base64UrlToBytes(invite.aPub),
            iAmEnroller: true,
            nonce: invite.nonce,
            offer: { evm: invite.evm, anchorChainId: invite.anchorChainId },
          });
          const credential = await createPasskeyCredential({
            passkey: opts.passkey,
            networkName: opts.operatorName ?? opts.rpId,
            evm: invite.evm as Address,
            anchorChainId: invite.anchorChainId,
          });
          const wrap = await sealWrap(key, { bPub: eph.publicKey, ...credential });
          credential.wrappingKey.fill(0); // sealed and sent; W is as powerful as K for this wallet
          // The caller now waits for the holder to land the write, then calls continue() to log in.
          // It cannot log in before that: its blob is what it decrypts, and the blob is not there yet.
          return { qr: encodePayload(wrap), sas, rpId: credential.rpId };
        },

        /**
         * REPAIR an orphan. Not a new protocol: this credential holds a PRF and no key, and the holder
         * holds the key and not this PRF — which is EXACTLY the position a fresh enroller is in. The
         * only difference is that the credential already exists, so create() becomes authenticate().
         *
         * The wrapping key it derives is bit-identical to the one the failed enrolment would have used
         * (the derivation binds only the public address and slot id), so the repaired slot opens under
         * this credential. A repair that produced a different W would be the original bug with extra
         * steps.
         */
        async repair(qr: string): Promise<{ qr: string; sas: string; rpId: string }> {
          // Same shape as mintAndWrap, and it must be: repair IS an enrolment whose credential already
          // exists. It takes the invite directly rather than reading session state, because there is
          // no earlier round left to have established any — that was the round the reduction removed.
          const invite = decodePayload<PairInvite>(qr, "invite");
          const eph = generateEphemeral();
          const { key, sas } = await deriveSession({
            myPrivate: eph.privateKey,
            myPublic: eph.publicKey,
            theirPublic: base64UrlToBytes(invite.aPub),
            iAmEnroller: true,
            nonce: invite.nonce,
            offer: { evm: invite.evm, anchorChainId: invite.anchorChainId },
          });
          // The orphan proves it holds the credential by authenticating it — and that same ceremony is
          // how it gets the PRF that reproduces its wrapping key.
          const discovered = await opts.passkey.discover();
          const credential = await repairPasskeyCredential({
            passkey: opts.passkey,
            credentialId: discovered.credentialId,
            rpId: opts.rpId,
            evm: invite.evm as Address,
          });
          const wrap = await sealWrap(key, { bPub: eph.publicKey, ...credential });
          credential.wrappingKey.fill(0);
          return { qr: encodePayload(wrap), sas, rpId: credential.rpId };
        },
      },
    },

    async addPasskey(
      ctx: AccessCtx,
      opts_?: { feeToken?: Address | null },
    ): Promise<{ slotId: Hex; txId: string; passkeyCount: number }> {
      const feeToken = opts_?.feeToken ?? null;
      const st = requireState();
      // Refuse before minting anything if the write path is already visibly dead (see preflight).
      // The fee token goes with it: affordability is measured against the balance that will PAY.
      await preflight(ctx, feeToken);
      // Enrolment and the on-chain write are ONE atomic call, deliberately. A secondary cannot
      // derive K (its PRF differs from the primary's), so it wraps the existing K under its own PRF
      // and its recovery depends entirely on that ciphertext being on chain. Enrolling without the
      // write would leave a dead device: a credential that can neither derive K nor decrypt a slot
      // that was never stored. Enrolling a secondary costs one funded transaction — that is the price
      // of a real second device, and it is paid here, once. (No largeBlob tier exists to avoid it.)
      // ONE gesture for the wallet key. Resolve the write first, with NO key, against a probe of the
      // exact same calldata length (BLOB_BYTES/META_BYTES are constants). The probe's slot id is a
      // placeholder — a slot id is 32 bytes whatever its value, so it does not change the length.
      const prepared = await ctx.prepareWrite(
        [accessSlotWriteProbe(st.evmAddress, `0x${"11".repeat(32)}`)],
        anchorChain.chainId,
      );

      // Unlock K ONCE and do everything that needs it inside: mint the secondary, wrap K under its
      // PRF, and sign the write. (Minting the credential is its own WebAuthn ceremony — you are
      // creating a passkey — but unlocking the wallet and signing the write are now a single
      // confirmation instead of two.)
      const mint = async ({ container }: { container: SecretContainer }) => {
        const r = await addPasskey({
          passkey: opts.passkey,
          networkName: opts.operatorName ?? opts.rpId,
          container,
          address: st.evmAddress,
          solanaAddress: st.solanaAddress,
          // Record this app's anchor in the new secondary's handle — the SAME chain the ciphertext is
          // submitted to below — so the marker always equals where the blob is stored.
          anchorChainId: anchorChain.chainId,
        });
        const slotId = deriveSlotId(st.evmAddress, r.slot.credentialId);
        // Ciphertext only — serializeBlob(blob) is the AES-encrypted blob at rest.
        const call = buildAddAccessSlotCall({
          address: st.evmAddress,
          slotId,
          encryptedBlob: serializeBlob(r.blob),
          encryptedMeta: r.encryptedMeta,
        });
        return { ...r, slotId, call };
      };

      let slot: Awaited<ReturnType<typeof mint>>["slot"];
      let blob: Awaited<ReturnType<typeof mint>>["blob"];
      let encryptedMeta: Uint8Array;
      let slotId: Hex;
      let signed: unknown;
      let write = prepared;

      if (feeToken) {
        // SPONSORED — TWO gestures, and the split is forced rather than chosen. The paymaster quotes
        // over the REAL calldata, the real calldata contains the sealed blob, and the blob needs K.
        // So: seal (key), fetch the quote (IO), sign (key). K is never live across that round-trip.
        const minted = await withWalletKeyAndContainer({ state: st, passkey: opts.passkey }, mint);
        ({ slot, blob, encryptedMeta, slotId } = minted);
        write = await ctx.sponsorWrite(prepared, [minted.call], feeToken);
        // A declined second gesture FAILS. It does not quietly fall back to self-pay: the caller asked
        // to pay in a token, and silently charging native gas instead is the degrade `requireSponsorship`
        // exists to prevent — worse here, because the user may hold no native gas at all.
        signed = await withWalletKeyAndContainer({ state: st, passkey: opts.passkey }, ({ account }) =>
          ctx.signWrite(write, [minted.call], scopedSigner(account, st)),
        );
      } else {
        // SELF-PAY — ONE gesture. The signature is built entirely in-process from the same-length
        // probe, so sealing and signing fit in a single scope with no IO between them.
        const done = await withWalletKeyAndContainer(
          { state: st, passkey: opts.passkey },
          async ({ container, account }) => {
            const r = await mint({ container });
            return { ...r, signed: await ctx.signWrite(prepared, [r.call], scopedSigner(account, st)) };
          },
        );
        ({ slot, blob, encryptedMeta, slotId, signed } = done);
      }

      state = { ...st, slots: [...st.slots, slot], blobs: [...st.blobs, { credentialId: slot.credentialId, blob }] };
      const passkeyCount = state.slots.length;
      void encryptedMeta; // sealed into the signed call above

      // Idempotent on a retry that re-enrols the SAME secondary: if this credential's slot is already
      // on the anchor chain, do not broadcast. The check sits AFTER signing because it needs the new
      // credential's id — and a signed-but-unsent transaction costs nothing and consumes no nonce.
      if (await ctx.hasSlot(slotId, anchorChain.chainId)) {
        return { slotId, txId: "noop", passkeyCount };
      }

      const receipt = await ctx.broadcastWrite(prepared, signed);
      return { slotId, txId: receipt.id, passkeyCount };
    },

    /**
     * The roster a settings screen actually needs: every access slot, WITH the domain that enrolled it.
     *
     * This seam has to exist here and nowhere else. `listAccessSlots` deliberately carries the access-slot
     * metadata as CIPHERTEXT (it is public on chain, and the listing must stay key-free), and decrypting
     * it needs the wallet key — which an app cannot have. So the decrypt happens inside the sandbox, K
     * is wiped on the way out, and the app receives plain strings.
     *
     * `rpId: null` means the metadata is absent or unreadable — a passkey enrolled before metadata existed,
     * or written by another implementation. Render it as "unknown domain", never as an error: one
     * unreadable access slot must not blank the whole list.
     *
     * THIS IS THE TRUST SURFACE, MADE VISIBLE (§6.4). Every domain listed here can reach the wallet key.
     */
    async listAccessSlots(): Promise<(AccessSlotEntry & { rpId: string | null })[]> {
      const st = requireState();
      const accessSlots = await enumerateAccessSlots();
      return withDecryptedContainer({ state: st, passkey: opts.passkey }, async (container) =>
        Promise.all(accessSlots.map(async (d) => ({ ...d, rpId: await readAccessSlotRpId(container.key, d) }))),
      );
    },

    /** The chain-verified number of access slots. THIS is the number behind "ways into this wallet" — never
     *  passkeyCount(), which counts local credentials and cannot tell an access slot from an orphan. */
    async accessSlotCount(): Promise<number> {
      return (await enumerateAccessSlots()).length;
    },

    async removeAccessSlot(ctx: AccessCtx, slotId: Hex, o: { confirm: true }): Promise<{ txId: string }> {
      // Explicit gate, exactly like export(): a caller cannot remove an access slot by accident, and a UI
      // must first show the access slot and the "this cannot un-learn a key it already has" warning.
      if (o.confirm !== true) throw new Error("Access-slot removal requires explicit confirmation");
      const st = requireState();
      const call = buildRemoveAccessSlotCall({ address: st.evmAddress, slotId });
      const receipt = await ctx.submit([call], { chainId: anchorChain.chainId });
      return { txId: receipt.id };
    },
  };
}
