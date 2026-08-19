import { createSiweMessage } from "viem/siwe";
import type { Hex, PrivateKeyAccount } from "viem";
import { getUserOperationHash, type UserOperation } from "viem/account-abstraction";
import { wrapRosterSignature, resolveEntryPoint, type AvokEntryPointVersion } from "../../evm/index.js";
import type { WalletState } from "../../wallet/index.js";
import type { SignConsentRequest } from "./consent.js";

/** The key a SINGLE passkey gesture yields (`withDiscoveredKeys`). */
export type SignKeys = { evm: PrivateKeyAccount };

/**
 * Browser-side signer for the shared-origin `/sign` popup — the money path.
 *
 * Signing is ALWAYS device-side: the wallet key is reconstructed from the passkey PRF inside the
 * popup, used, and discarded. The origin never sees it. (The old server-side `POST /sign` endpoint
 * was removed for exactly that reason — but the popup was never rewired, so Approve 404'd and
 * shared-origin signing was dead. This is the missing half.)
 *
 * Deliberately PURE and gesture-free: the caller performs the ONE `withDiscoveredKeys` gesture and
 * passes the resulting keys in. That keeps every op unit-testable without WebAuthn — a real browser
 * is needed to *acquire* the keys, not to prove we use them correctly.
 *
 * It dispatches over the SAME `SignConsentRequest` union the consent screen decodes, so what the user
 * is shown and what actually gets signed cannot drift apart.
 *
 * ROSTER SIGNERS (D8): `state.walletAddress !== state.evmAddress` for every device enrolled after the
 * founding one — its own key is a registered Calibur signer, not the wallet's own EIP-7702 delegate.
 * See `evm/roster-signature.ts`'s module header for exactly which ops need wrapping for that case,
 * which don't, and which are refused outright rather than producing a signature Calibur would reject
 * silently downstream.
 *
 * Return shapes are the exact contract `createRemoteSigner` (packages/shared-origin) expects — note that
 * `signAuthorization` and `signTransaction` return their value RAW, not wrapped in an object.
 */
export async function performSign(request: SignConsentRequest, keys: SignKeys, state: WalletState): Promise<unknown> {
  const isRosterSigner = state.walletAddress.toLowerCase() !== state.evmAddress.toLowerCase();

  switch (request.op) {
    case "signMessage":
    case "signTypedData":
    case "signSiwe":
      // Calibur verifies these through ERC-1271 `isValidSignature`, whose non-root-key branch
      // requires an ERC-7739 nested-typed-data signature — a materially different scheme this
      // module does not yet implement (see roster-signature.ts). A plain signature from a roster
      // key would look successful here and fail verification later, silently — refuse instead.
      if (isRosterSigner) {
        throw new Error(
          `${request.op} is not yet supported for a roster (non-founding) signer — Calibur verifies it via ` +
            "ERC-7739, which this device does not implement. Sign in from the founding device for now.",
        );
      }
      break;
    default:
      break;
  }

  switch (request.op) {
    case "signMessage":
      return { signature: await keys.evm.signMessage({ message: request.message }) };

    case "signTypedData":
      return { signature: await keys.evm.signTypedData(request.typedData) };

    case "signSiwe": {
      // Build the EIP-4361 message from the WALLET's address — never the signer's own, and never one
      // supplied by the caller.
      const message = createSiweMessage({ ...request.params, address: state.walletAddress });
      const signature: Hex = await keys.evm.signMessage({ message });
      return { message, signature };
    }

    case "signAuthorization":
      // A roster signer's own key is never the wallet's EIP-7702 delegate — only the founding
      // device's key ever authorizes a delegation, and only while the wallet is still undelegated
      // (a roster entry cannot exist before that point). Refuse rather than sign a 7702
      // authorization for the wrong address.
      if (isRosterSigner) throw new Error("A roster signer cannot authorize an EIP-7702 delegation");
      // Raw result (viem returns { ...fields, v }; the client's SignedAuthorizationLike omits v).
      return keys.evm.signAuthorization(request.authorization);

    case "signTransaction":
      // Raw Hex — the client returns this value directly. `request.tx.to` already names the wallet
      // (the client built it from `connection.account()`); Calibur authorizes by CALLER IDENTITY on
      // this path (`_isOwnerOrValidKey(msg.sender.toKeyHash())`), so a roster signer's ordinary,
      // unwrapped transaction signature is exactly what a founding device's is — no special-casing.
      return keys.evm.signTransaction(request.tx);

    // ── COMPOSITE OPS — TWO signatures, ONE gesture ────────────────────────────────────────────────
    // `keys` came from a SINGLE withDiscoveredKeys the caller already performed, so signing twice here
    // costs the user nothing extra. Sent as separate signAuthorization + signTransaction requests they
    // were two popups and two biometric prompts for one "Send" — and they cannot be a generic batch,
    // because the transaction EMBEDS the signed authorization.

    case "signSend": {
      if (!request.authorization) {
        // Already delegated: an ordinary type-2 transaction. Same "authorize by caller identity"
        // reasoning as the plain signTransaction case above — no wrapping for a roster signer.
        return keys.evm.signTransaction(request.tx);
      }
      if (isRosterSigner) throw new Error("A roster signer cannot authorize an EIP-7702 delegation");
      const signedAuth = await keys.evm.signAuthorization(request.authorization);
      // Raw Hex, exactly like signTransaction — the client returns it directly.
      // Cast: TransactionSerializable is a discriminated union and spreading into it widens past
      // viem's OneOf<> guard. The shape is the eip7702 variant by construction.
      return keys.evm.signTransaction({
        ...request.tx,
        type: "eip7702",
        authorizationList: [signedAuth],
      } as unknown as Parameters<typeof keys.evm.signTransaction>[0]);
    }

    case "signSponsored": {
      // Legacy/unused by the current sponsored rail (client/evm.ts sends via signUserOp only) — left
      // as-is rather than guessing at roster-wrapping semantics nothing currently exercises.
      const authorization = request.authorization ? await keys.evm.signAuthorization(request.authorization) : undefined;
      const signature = await keys.evm.signTypedData(request.typedData);
      return { signature, ...(authorization ? { authorization } : {}) };
    }

    case "signUserOp": {
      // Recompute the userOpHash from the SUPPLIED fields — never trust a caller-supplied hash, so
      // the signed digest is provably the one derived from the batch the consent screen decoded. The
      // hash is already the EIP-712 digest the contract's validateUserOp checks, so sign it RAW.
      // `entryPointVersion` MUST match what the target wallet's `ENTRY_POINT()` actually trusts — see
      // `evm/entrypoint.ts` — or this hash is for the wrong EntryPoint and validateUserOp rejects it.
      if (isRosterSigner && request.authorization) {
        throw new Error("A roster signer cannot authorize an EIP-7702 delegation");
      }
      const authorization = request.authorization ? await keys.evm.signAuthorization(request.authorization) : undefined;
      const entryPointVersion = request.entryPointVersion as AvokEntryPointVersion;
      const userOpHash = getUserOperationHash({
        chainId: request.chainId,
        entryPointAddress: resolveEntryPoint(entryPointVersion).address,
        entryPointVersion,
        userOperation: request.userOp as unknown as UserOperation<AvokEntryPointVersion>,
      });
      const rawSignature = await keys.evm.sign({ hash: userOpHash });
      // `validateUserOp` accepts a raw signature only for the root (founding-device) key; any other
      // registered key must be named via the wrapped envelope (roster-signature.ts).
      const signature = isRosterSigner ? wrapRosterSignature(state.evmAddress, rawSignature) : rawSignature;
      return { signature, ...(authorization ? { authorization } : {}) };
    }
  }
}
