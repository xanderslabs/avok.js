/**
 * Has a wallet ever been established in this browser?
 *
 * This ONLY chooses which copy the entry screen shows (returning → "Sign in"; cold → the two
 * access slots). It is not sensitive, not authoritative, and grants nothing: the wallet is reachable
 * only through the credential itself. If it is missing — private window, cleared site data, a
 * new browser — the cold view is the correct and safe fallback, which is why every failure path
 * here returns `false` rather than throwing.
 */
const KEY = "avok-demo:returning";

export function isReturning(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage unavailable (private mode) — show the cold view
  }
}

export function markReturning(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* storage unavailable — the user simply sees the cold view next time */
  }
}
