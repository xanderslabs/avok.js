import { base64 } from "@scure/base";
import type { Hex, TransactionSerializable, TypedDataDefinition } from "viem";
import type { SigningChannel } from "./channels/port.js";
import type { SignRequest, SignedAuthorizationLike, Signer, SiweParams } from "./types.js";
import { throwIfSignError } from "./sign-errors.js";

export function createRemoteSigner({
  channel,
  credentialId,
}: {
  channel: SigningChannel;
  /** The passkey this account was established with, so the popup can constrain the assertion and go
   *  straight to biometrics. Carried here because the access token used to carry it (#8). */
  credentialId?: string;
}): Signer {
  async function sign<T>(request: SignRequest): Promise<T> {
    const result = await channel.open({ kind: "sign", request, credentialId } as Parameters<SigningChannel["open"]>[0]);
    if (result.kind !== "sign") {
      throw new Error(`SigningChannel contract violated: expected kind="sign", got kind="${result.kind}"`);
    }
    // A refusal (user_rejected) is not a signature — throw, never cast it through.
    throwIfSignError(result.result);
    // The origin guarantees op→result correspondence; cast at the boundary.
    return result.result as T;
  }

  return {
    async signMessage({ message }: { message: string }): Promise<Hex> {
      const result = await sign<{ signature: Hex }>({ op: "signMessage", message });
      return result.signature;
    },

    async signTypedData(args: TypedDataDefinition): Promise<Hex> {
      const result = await sign<{ signature: Hex }>({ op: "signTypedData", typedData: args });
      return result.signature;
    },

    async signSiwe(params: SiweParams): Promise<{ message: string; signature: Hex }> {
      const result = await sign<{ message: string; signature: Hex }>({ op: "signSiwe", params });
      return { message: result.message, signature: result.signature };
    },

    // ── COMPOSITE OPS — ONE round-trip, ONE popup, ONE biometric prompt ──────────────────────────
    // Sending these as separate signAuthorization + signTransaction requests meant TWO popups and
    // TWO prompts for one "Send". They cannot be batched generically either: the transaction EMBEDS
    // the signed authorization, so the second request needs the first's output. The origin does both
    // under the single gesture it already performs.

    async signSend(args): Promise<Hex> {
      return sign<Hex>({ op: "signSend", tx: args.tx, authorization: args.authorization });
    },

    async signSponsored(args): Promise<{ signature: Hex; authorization?: SignedAuthorizationLike }> {
      return sign<{ signature: Hex; authorization?: SignedAuthorizationLike }>({
        op: "signSponsored",
        typedData: args.typedData,
        authorization: args.authorization,
      });
    },

    async signUserOp(args): Promise<{ signature: Hex; authorization?: SignedAuthorizationLike }> {
      return sign<{ signature: Hex; authorization?: SignedAuthorizationLike }>({
        op: "signUserOp",
        userOp: args.userOp,
        chainId: args.chainId,
        authorization: args.authorization,
      });
    },

    async signAuthorization(authorization: {
      chainId: number;
      address: `0x${string}`;
      nonce: number;
    }): Promise<SignedAuthorizationLike> {
      return sign<SignedAuthorizationLike>({ op: "signAuthorization", authorization });
    },

    async signTransaction(tx: TransactionSerializable): Promise<Hex> {
      return sign<Hex>({ op: "signTransaction", tx });
    },

    async signSolanaTransaction(messageBytes: Uint8Array, opts?: { cluster?: string }) {
      const request = { op: "signSolanaTransaction" as const, messageBytesB64: base64.encode(messageBytes) };
      return sign<{ signature: string; consent: unknown }>(
        opts?.cluster ? { ...request, cluster: opts.cluster } : request,
      );
    },

    async signSolanaMessage(message: string) {
      return sign<{ signature: string }>({ op: "signSolanaMessage", message });
    },
  };
}
