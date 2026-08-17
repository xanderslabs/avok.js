/**
 * The authorize challenge — what makes a shared-origin account self-authenticating.
 *
 * `connect()` receives an address from the wallet. On the web popup that address arrives with a
 * browser-enforced origin, so it can only have come from the auth origin. On a transport that answers
 * over a callback URL — the only shape a native in-app browser session offers — nothing about the
 * reply says who sent it. So the address is verified rather than trusted: the caller issues a random
 * challenge, the wallet signs it, and the signature must recover to the address it claims.
 *
 * The message is BOUND to the auth origin and to a version tag, and both matter:
 *
 *   - Without the origin, a signature obtained by operator A is replayable at operator B. A user who
 *     signs into one wallet would be handing anyone watching a valid proof for a different one.
 *   - Without a purpose tag, this is an oracle for signing arbitrary-looking payloads. Every
 *     signing surface a wallet exposes must be unmistakable for every other, or one of them becomes
 *     a way to obtain signatures for another.
 *
 * Normative: two independent implementations must produce byte-identical text, so this format is
 * part of the wire protocol. It is deliberately plain, readable ASCII — this string may be shown to a
 * human by a wallet that renders what it signs, and a person should be able to tell what it is.
 */
import { verifyMessage } from "viem";
import type { Address, Hex } from "viem";

const AUTHORIZE_PROOF_VERSION = "v1" as const;

/** 128 bits of randomness, hex. Fresh per connect: a reused nonce is a replayable proof. */
export function randomAuthorizeNonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The exact text the wallet signs. Both sides MUST build it identically. */
export function authorizeChallenge(args: { nonce: string; authOrigin: string }): string {
  // Normalised via URL().origin so a configured value carrying a path or trailing slash produces the
  // same challenge as the bare origin — otherwise two honest sides sign different strings.
  const origin = new URL(args.authOrigin).origin;
  return [
    `Avok shared-origin authorization ${AUTHORIZE_PROOF_VERSION}`,
    `origin: ${origin}`,
    `nonce: ${args.nonce}`,
  ].join("\n");
}

/**
 * Does `proof` prove that whoever holds `evmAddress` answered THIS challenge?
 *
 * Returns a boolean rather than throwing: the caller decides what a failure means, and at the one
 * call site it means refusing the connection outright.
 */
export async function verifyAuthorizeProof(args: {
  evmAddress: Address;
  nonce: string;
  authOrigin: string;
  proof: Hex;
}): Promise<boolean> {
  try {
    return await verifyMessage({
      address: args.evmAddress,
      message: authorizeChallenge({ nonce: args.nonce, authOrigin: args.authOrigin }),
      signature: args.proof,
    });
  } catch {
    // A malformed signature is a failed proof, not a crash. The distinction does not matter to the
    // caller — both mean "this account is unverified" — and letting it throw would turn a hostile
    // reply into an unhandled rejection.
    return false;
  }
}
