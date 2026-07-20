import type { Hex } from "viem";
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
  //
  // `nonce` is a fresh random challenge the CALLER generates. The wallet signs it and returns the
  // signature as `proof`, which is what makes the returned account self-authenticating — see
  // ChannelResult below for why that is load-bearing on transports without origin authenticity.
  | { kind: "authorize"; nonce: string };

export type ChannelResult =
  | { kind: "sign"; result: SignResult }
  // The popup returns the ACCOUNT itself. There is no OIDC code to exchange and no token to mint —
  // the address is not a secret.
  //
  // `proof` is a signature over the caller's `nonce`, and it exists because "a lying reply could only
  // make a dapp DISPLAY a wrong address" is a WEAKER claim than it first sounds, and rests on an
  // assumption not every transport can make.
  //
  // On the web popup the reply is authenticated for free: postMessage carries a browser-enforced
  // origin, so a reply can only come FROM the auth origin. A transport that answers over a callback
  // URL — which is the only shape available to a native in-app browser session — proves nothing about
  // who redirected. Anything able to steer that tab (an open redirect on the auth origin, a
  // third-party script, an ad) can return an attacker's address. And an app showing a user a
  // receiving address they do not control is a funds-loss path, not a cosmetic bug.
  //
  // A `state`-style nonce alone would not fix it either: whoever received the navigation can read the
  // nonce and echo it. Only a SIGNATURE over that nonce is unforgeable without the wallet key, which
  // makes the account verifiable independently of how it travelled.
  | { kind: "authorize"; account: SharedAccount; proof: Hex };
