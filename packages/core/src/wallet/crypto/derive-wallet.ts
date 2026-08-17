import { stringToBytes } from "viem";
import { bytesToArrayBuffer } from "../encoding.js";

/** Fixed, non-secret HKDF salt, shared by the wallet key and every slot key. RFC 5869 permits an
 *  empty salt; a constant one is strictly better. Vendor-neutral: this ships in the standard. */
export const HKDF_SALT = "passkey-access-vault/hkdf-salt/v0";

/** HKDF `info` for the wallet key — this string, plus HKDF_SALT, is the entire domain separation
 *  between the wallet key and any other derivation this codebase ever adds under the same PRF. */
export const WALLET_INFO = "passkey-access-vault/wallet-key/v0";

let prfSaltCache: Uint8Array | undefined;
/**
 * The PRF salt — the FIRST input to the entire key chain: PRF = authenticator(salt), K = HKDF(PRF).
 *
 * As NORMATIVE as the HKDF domains above, and vendor-neutral for the same reason: the PRF output is
 * deterministic per (credential, salt), so any conforming implementation that opens the same passkey —
 * a replacement app on the same domain, a sibling app sharing the rpId, a second implementer of the
 * standard — MUST pass byte-identical salt bytes or it derives a different K and silently lands in a
 * DIFFERENT WALLET. A vendor's name here would make every other implementer recite it.
 *
 * Lives here (not in the browser adapter) so BOTH platform adapters — web and the DOM-free native base —
 * read the one normative salt without either depending on the other. Changing this value changes every
 * K, i.e. every wallet; it is frozen the moment real users hold value.
 */
export function getPrfSalt(): Uint8Array {
  return (prfSaltCache ??= new TextEncoder().encode("passkey-access-vault/prf-salt/v0"));
}

/**
 * The wallet key K = HKDF-SHA256(PRF output). This is the ONLY place K is born.
 *
 * Consequence, stated once so nobody has to rediscover it: a single PRF evaluation now equals the
 * wallet. Any origin whose RP-ID matches can request one. That is why the RP-ID must be fixed and
 * narrow and why /.well-known/webauthn is a key-access control list.
 */
export async function deriveWalletKey(prfOutput: ArrayBuffer): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: bytesToArrayBuffer(stringToBytes(HKDF_SALT)),
      info: bytesToArrayBuffer(stringToBytes(WALLET_INFO)),
    },
    baseKey,
    256,
  );
  // K is returned as mutable bytes so the sandbox can zero it after use. Copy out of the
  // WebCrypto-owned buffer and wipe that intermediate, leaving one caller-controlled copy of K.
  // (baseKey is a non-extractable CryptoKey — opaque, nothing to wipe. prfOutput belongs to the
  // caller and is wiped by the sandbox entry point, not here, so direct/test callers keep control.)
  const key = Uint8Array.from(new Uint8Array(bits));
  new Uint8Array(bits).fill(0);
  return key;
}
