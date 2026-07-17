import type { Hex, TypedDataDefinition } from "viem";
import { createSiweMessage } from "viem/siwe";
import type { PasskeyAdapter } from "./passkey/adapter.js";
import { withWalletKey, type WalletState } from "./sandbox.js";

type SignArgs = { state: WalletState; passkey: PasskeyAdapter; credentialId?: string };

/** EIP-191 personal-sign over `message`, one passkey gesture, key never escapes the sandbox. */
export function signMessage(args: SignArgs & { message: string }): Promise<Hex> {
  return withWalletKey(args, (account) => account.signMessage({ message: args.message }));
}

/** EIP-712 typed-data signature (the Tx Engine builds the FrontedBatch typed data, signs here). */
export function signTypedData(args: SignArgs & { typedData: TypedDataDefinition }): Promise<Hex> {
  return withWalletKey(args, (account) => account.signTypedData(args.typedData));
}

export type SiweParams = Omit<Parameters<typeof createSiweMessage>[0], "address">;

/** EIP-4361 sign-in: build the message for the wallet address, then personal-sign it. */
export async function signSiwe(args: SignArgs & { params: SiweParams }): Promise<{ message: string; signature: Hex }> {
  const message = createSiweMessage({ ...args.params, address: args.state.evmAddress });
  const signature = await withWalletKey(args, (account) => account.signMessage({ message }));
  return { message, signature };
}
