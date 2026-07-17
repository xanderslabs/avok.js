import type { SignResult } from "./types.js";

/** The user pressed Reject in the signing popup. Not a failure — a decision. */
export class UserRejectedError extends Error {
  constructor() {
    super("The signing request was rejected");
    this.name = "UserRejectedError";
  }
}

/**
 * Turn a popup refusal into a thrown error. A `SignResult` carrying `error` is NOT a signature, and
 * handing it back untouched (as the signer used to) means the caller reads `.signature` off it and
 * gets `undefined` — a rejected transaction that looks like a successful one with a missing field.
 */
export function throwIfSignError(result: SignResult): void {
  if (typeof result !== "object" || result === null || !("error" in result)) return;
  const { error } = result as { error: string };
  if (error === "user_rejected") throw new UserRejectedError();
  throw new Error(`Signing failed: ${error}`);
}
