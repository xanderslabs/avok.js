// A headless `Connection` for E2E scripts: same signing primitives the real Vault's `/sign` popup
// uses (`withWalletKey` + `performSign`), minus the postMessage channel and the browser. This is NOT
// a mock — it derives the same K = HKDF(PRF) from a real `PasskeyAdapter` and signs with the same
// `performSign` dispatcher the popup calls in-page (src/auth-popup/sign/perform-sign.ts). Only the
// transport (popup vs. direct call) differs, which is exactly the seam `performSign`'s own module
// header says is browser-only for ACQUIRING the key, not for using it.
import type { Address, Hex, TransactionSerializable, TypedDataDefinition } from "viem";
import { withWalletKey, type WalletState } from "../../src/wallet/sandbox.js";
import type { PasskeyAdapter } from "../../src/wallet/passkey/adapter.js";
import { performSign } from "../../src/auth-popup/sign/perform-sign.js";
import type { SignConsentRequest, UserOpRequest } from "../../src/auth-popup/sign/consent.js";
import type { Connection, Account, ContinueOpts } from "../../src/types.js";
import type { AuthorizationTriple, SignedAuthorizationLike } from "../../src/channel/types.js";

export function makeDirectConnection(args: { state: WalletState; passkey: PasskeyAdapter }): Connection {
  const { state, passkey } = args;

  function run<T>(request: SignConsentRequest): Promise<T> {
    return withWalletKey({ state, passkey }, (account) => performSign(request, { evm: account }, state) as Promise<T>);
  }

  return {
    signMessage: (a) => run<{ signature: Hex }>({ op: "signMessage", message: a.message }).then((r) => r.signature),
    signTypedData: (a) => run<{ signature: Hex }>({ op: "signTypedData", typedData: a }).then((r) => r.signature),
    signSiwe: (p) => run<{ message: string; signature: Hex }>({ op: "signSiwe", params: p }),
    signSend: (a: { tx: TransactionSerializable; authorization?: AuthorizationTriple }) =>
      run<Hex>({ op: "signSend", tx: a.tx, authorization: a.authorization }),
    signSponsored: (a: { typedData: TypedDataDefinition; authorization?: AuthorizationTriple }) =>
      run<{ signature: Hex; authorization?: SignedAuthorizationLike }>({
        op: "signSponsored",
        typedData: a.typedData,
        authorization: a.authorization,
      }),
    signUserOp: (a) =>
      run<{ signature: Hex; authorization?: SignedAuthorizationLike }>({
        op: "signUserOp",
        userOp: a.userOp as unknown as UserOpRequest,
        chainId: a.chainId,
        entryPointVersion: a.entryPointVersion,
        authorization: a.authorization,
      }),
    signAuthorization: (a: { chainId: number; address: Address; nonce: number }) =>
      run<SignedAuthorizationLike>({ op: "signAuthorization", authorization: a }),
    signTransaction: (tx: TransactionSerializable) => run<Hex>({ op: "signTransaction", tx }),

    async continue(_opts?: ContinueOpts): Promise<Account> {
      return { evm: { address: state.walletAddress } };
    },
    logout(): void {
      // No session state to clear outside `state` itself — the caller owns it.
    },
    account(): Account | null {
      return { evm: { address: state.walletAddress } };
    },
    status(): boolean {
      return true;
    },
  };
}
