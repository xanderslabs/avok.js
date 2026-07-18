import {
  type PasskeyAdapter,
  type VaultReader,
  type WalletState,
  decodeUserHandle,
  deriveWalletKey,
  reconstructFromKey,
  reconstructWalletState,
  resolveBlob,
  vaultForChainFromRegistry,
} from "@avokjs/core/wallet";
import { getChainProfile } from "@avokjs/contracts";

/**
 * A secondary credential's encrypted blob lives on chain. If we cannot read it, the wallet is fine
 * and the network is not — never conflate the two. This is distinct from "no wallet found": a
 * secondary whose vault read fails is unreachable, not gone, and the caller should retry, not
 * despair. Defined here (not imported) because auth-origin does not depend on sdk-core, where the
 * own-origin connection defines an identically-named error for the same reason.
 */
export class SlotUnreachableError extends Error {
  constructor() {
    super("Could not reach the access-slot chain to unlock this device. Check your connection and retry.");
    this.name = "SlotUnreachableError";
  }
}

/**
 * The credential was never finished enrolling: the chain ANSWERED and has no access slot for it. Distinct from
 * SlotUnreachableError, which means the chain did not answer — telling an orphaned user to "check your
 * connection and retry" is advice that can never succeed.
 *
 * The shared-origin origin cannot repair it: repair needs a surviving passkey to re-encrypt the key, and this
 * origin holds no key and runs no enrolment ceremony. It can only name the condition truthfully and
 * point the user at a device that still works.
 */
export class OrphanedCredentialError extends Error {
  constructor() {
    super("This passkey was never finished enrolling, so it cannot open this wallet. Repair it from a device that still works.");
    this.name = "OrphanedCredentialError";
  }
}

/**
 * Transiently reconstruct the user's WalletState at the auth origin.
 *
 * One `discover()` assertion yields the credential id, the opaque user handle and the PRF output.
 * The handle's kind byte picks the path:
 *  - PRIMARY: the passkey IS the wallet. K = HKDF(PRF) is derived offline — no vault, no RPC, no
 *    network — and the addresses fall straight out of K. There is no on-chain slot to read and no
 *    expected address to compare against: the derived address IS the identity.
 *  - SECONDARY: its handle carries the wallet's addresses. The encrypted blob is read from the
 *    on-chain access vault (anchor chain) and reconstructed into state; decryption happens later,
 *    inside the sign handler's `withWalletKey` call, under this credential's own PRF.
 *
 * The returned state is used immediately for signing and must not be persisted by the caller.
 *
 * (There is no largeBlob tier: iCloud Keychain does not implement the extension — measured by a
 * real write-and-read in both Safari and Chrome — so it could never be a universal mechanism.)
 */
export async function materializeWalletState(args: {
  passkey: PasskeyAdapter;
  /** Optional hint: when the credential is already known from a prior gesture, supply it here to
   *  override the discovered one. discover() is still called so the handle and PRF are recovered. */
  credentialId?: string;
  /** Injected VaultReader for the secondary path. When provided, used instead of constructing an
   *  inline viem-based reader from the marker chain's registry RPC. Enables testing without a live
   *  RPC connection. */
  vaultReader?: VaultReader;
}): Promise<WalletState> {
  const discovered = await args.passkey.discover();
  const credentialId = args.credentialId ?? discovered.credentialId;
  const handle = decodeUserHandle(discovered.userHandle);

  if (handle.kind === "primary") {
    // The passkey IS the wallet: K = HKDF(PRF), derived offline. No vault, no RPC, no network — a
    // primary reconstructs its wallet at every login on every provider. The discovered credential
    // becomes the local slot so the sign handler can later re-authenticate it.
    const base = reconstructFromKey(await deriveWalletKey(discovered.prfOutput));
    return { ...base, slots: [{ credentialId, rpId: "", createdAt: new Date().toISOString() }] };
  }

  // Secondary: the handle carries the wallet's addresses AND the anchor chain its blob was written
  // to (the marker). Its blob lives on THAT chain — which may differ from this origin's own anchor
  // config when a sibling app sharing the rpId enrolled it — so resolve the vault from the marker
  // chain's registry RPC, never a single origin-configured anchor. An unreadable vault is a NETWORK
  // problem — the wallet is fine — so never report it as "no wallet found". Both the read failing and
  // the read returning nothing are unreachable-blob conditions, and both are retryable.
  let anchorVault: VaultReader;
  if (args.vaultReader) {
    anchorVault = args.vaultReader;
  } else {
    // The marker names a chain absent from the registry — we have no RPC to read its blob. Fail
    // loud rather than query the wrong chain and silently return "not found". (The shared builder
    // also throws on an unknown chain, but as a plain Error; this guard keeps the retryable
    // SlotUnreachableError this origin surfaces.)
    if (!getChainProfile(handle.anchorChain)) throw new SlotUnreachableError();
    anchorVault = vaultForChainFromRegistry(handle.anchorChain);
  }

  let result: Awaited<ReturnType<typeof resolveBlob>>;
  try {
    result = await resolveBlob({ address: handle.evm, credentialId, anchorVault });
  } catch {
    // The chain did not answer. Retryable, and it says nothing about the wallet.
    throw new SlotUnreachableError();
  }
  // The chain ANSWERED and has no access slot for this credential — an orphan. Not retryable, and not this
  // origin's to repair (it holds no key): say so, rather than looping the user on "check your
  // connection". Same classification as the own-origin connection, deliberately: a shared-origin user must not
  // get a different story about the same wallet.
  if (!result) throw new OrphanedCredentialError();
  // The blob no longer carries its addresses: reconstruct decrypts it under this credential's PRF and
  // derives them. Re-supply what the blob dropped — the wallet address and credentialId come from the
  // secondary handle / discover() that FOUND the blob. The materialized slot's rpId is cosmetic and
  // unused by the sign path (this path re-discovers to sign), matching the primary branch's `rpId: ""`.
  return reconstructWalletState({
    blob: result.blob,
    address: handle.evm,
    credentialId,
    rpId: "",
    prfOutput: discovered.prfOutput,
  });
}
