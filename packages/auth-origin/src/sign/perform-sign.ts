import { base58, base64 } from "@scure/base";
import { createSiweMessage } from "viem/siwe";
import type { Hex, PrivateKeyAccount } from "viem";
import { getUserOperationHash, entryPoint08Address, type UserOperation } from "viem/account-abstraction";
import { encodeOffchainMessage } from "@avokjs/solana-txengine";
import type { SolanaSigner, WalletState } from "@avokjs/wallet-core";
import type { SignConsentRequest } from "./consent.js";

/** The keys a SINGLE passkey gesture yields (`withDiscoveredKeys`). */
export type SignKeys = { evm: PrivateKeyAccount; solana: SolanaSigner };

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
 * Return shapes are the exact contract `createRemoteSigner` (packages/shared-origin) expects — note that
 * `signAuthorization` and `signTransaction` return their value RAW, not wrapped in an object.
 */
export async function performSign(
  request: SignConsentRequest,
  keys: SignKeys,
  state: WalletState,
  rpId: string,
): Promise<unknown> {
  switch (request.op) {
    case "signMessage":
      return { signature: await keys.evm.signMessage({ message: request.message }) };

    case "signTypedData":
      return { signature: await keys.evm.signTypedData(request.typedData) };

    case "signSiwe": {
      // Build the EIP-4361 message from the wallet's OWN address — never one supplied by the caller.
      const message = createSiweMessage({ ...request.params, address: state.evmAddress });
      const signature: Hex = await keys.evm.signMessage({ message });
      return { message, signature };
    }

    case "signAuthorization":
      // Raw result (viem returns { ...fields, v }; the client's SignedAuthorizationLike omits v).
      return keys.evm.signAuthorization(request.authorization);

    case "signTransaction":
      // Raw Hex — the client returns this value directly.
      return keys.evm.signTransaction(request.tx);

    // ── COMPOSITE OPS — TWO signatures, ONE gesture ────────────────────────────────────────────────
    // `keys` came from a SINGLE withDiscoveredKeys the caller already performed, so signing twice here
    // costs the user nothing extra. Sent as separate signAuthorization + signTransaction requests they
    // were two popups and two biometric prompts for one "Send" — and they cannot be a generic batch,
    // because the transaction EMBEDS the signed authorization.

    case "signSend": {
      if (!request.authorization) {
        // Already delegated: an ordinary type-2 transaction.
        return keys.evm.signTransaction(request.tx);
      }
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

    case "signFronted": {
      const authorization = request.authorization
        ? await keys.evm.signAuthorization(request.authorization)
        : undefined;
      const signature = await keys.evm.signTypedData(request.typedData);
      return { signature, ...(authorization ? { authorization } : {}) };
    }

    case "signUserOp": {
      // Recompute the v0.8 userOpHash from the SUPPLIED fields — never trust a caller-supplied hash, so
      // the signed digest is provably the one derived from the batch the consent screen decoded. The
      // hash is already the EIP-712 digest the contract's validateUserOp checks, so sign it RAW.
      const authorization = request.authorization
        ? await keys.evm.signAuthorization(request.authorization)
        : undefined;
      const userOpHash = getUserOperationHash({
        chainId: request.chainId,
        entryPointAddress: entryPoint08Address,
        entryPointVersion: "0.8",
        userOperation: request.userOp as unknown as UserOperation<"0.8">,
      });
      const signature = await keys.evm.sign({ hash: userOpHash });
      return { signature, ...(authorization ? { authorization } : {}) };
    }

    case "signSolanaTransaction": {
      const signature = await keys.solana.sign(base64.decode(request.messageBytesB64));
      return { signature: base58.encode(signature), consent: undefined };
    }

    case "signSolanaMessage": {
      // Domain-separated offchain message (never a bare transaction payload — a raw signature over
      // attacker-chosen bytes could be replayed as a transaction).
      const bytes = encodeOffchainMessage({ message: request.message, rpId });
      return { signature: base58.encode(await keys.solana.sign(bytes)) };
    }
  }
}
