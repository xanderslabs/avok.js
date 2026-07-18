import type { SignRequest, SignResult, SharedAccount } from "../types.js";

export interface SigningChannel {
  open(req: ChannelRequest): Promise<ChannelResult>;
}

export type ChannelRequest =
  // `credentialId` replaces the old `sessionId`. sessionId existed to authenticate a token-gated
  // decode endpoint that no longer exists (#8) — but the token was ALSO what carried the
  // credentialId down to the popup, and without it the browser cannot constrain the assertion, so
  // the user is asked to pick a passkey on EVERY signature. The app holds it (connect() returned
  // it) and sends it here.
  | { kind: "sign"; request: SignRequest; credentialId?: string }
  // Both kinds open the SAME page (the wallet-sandbox popup at the auth origin root), so authorize
  // carries no URL: the channel knows the single page to open, and the popup reads nothing from it.
  | { kind: "authorize" };

export type ChannelResult =
  | { kind: "sign"; result: SignResult }
  // The popup returns the ACCOUNT itself. There is no OIDC code to exchange and no token to mint:
  // the address is not a secret, and a lying popup could only make a dapp DISPLAY a wrong address —
  // it cannot sign, because every action needs a passkey gesture on the real origin.
  | { kind: "authorize"; account: SharedAccount };
