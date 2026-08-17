import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { deriveWalletKey, HKDF_SALT, WALLET_INFO, getPrfSalt } from "../../src/wallet/crypto/derive-wallet.js";

const prf = (fill: number) => new Uint8Array(32).fill(fill).buffer;

describe("deriveWalletKey", () => {
  it("is deterministic — the same PRF output always yields the same wallet key", async () => {
    // This is the entire durability promise: log out, log back in, same passkey, same wallet.
    expect(await deriveWalletKey(prf(7))).toEqual(await deriveWalletKey(prf(7)));
  });

  it("is a 32-byte key (mutable bytes, not an immutable hex string)", async () => {
    const key = await deriveWalletKey(prf(1));
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("separates wallets — a different PRF output yields a different key", async () => {
    expect(await deriveWalletKey(prf(1))).not.toEqual(await deriveWalletKey(prf(2)));
  });

  it("never returns the raw PRF output", async () => {
    // If K were the PRF bytes themselves, any code path that leaked a PRF evaluation would leak
    // the key in a directly recognisable form. HKDF is what stands between them.
    expect(await deriveWalletKey(prf(7))).not.toEqual(new Uint8Array(32).fill(7));
  });
});

describe("domain strings are vendor-neutral", () => {
  it("contains no vendor name", () => {
    // A standard cannot carry a vendor's name in its key derivation: a second implementer would be
    // reciting ours in their own product's crypto.
    for (const s of [HKDF_SALT, WALLET_INFO]) {
      expect(s.toLowerCase()).not.toContain("avok");
    }
    expect(new TextDecoder().decode(getPrfSalt()).toLowerCase()).not.toContain("avok");
  });

  /**
   * THE BACKSTOP. The list above is a list, and lists go stale. This scans the SOURCE of every
   * module that performs a derivation and fails on any vendor-named string literal, so a future
   * `info: "avok-something"` cannot be added without a conscious fight with this test.
   */
  it("no derivation module contains a vendor-named string literal at all", () => {
    const modules = ["../../src/wallet/crypto/derive-wallet.ts", "../../src/wallet/passkey/web.ts"];
    for (const rel of modules) {
      const raw = readFileSync(join(import.meta.dirname, rel), "utf8");
      // Strip comments FIRST. An apostrophe in prose ("the wallet's key") otherwise opens a bogus
      // string literal that swallows the code after it — the scan must look at code, not prose, and
      // comments are of course free to name the product.
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      const literals = code.match(/(["'`])(?:\\.|(?!\1)[^\\])*?\1/g) ?? [];
      const offenders = literals.filter((l) => l.toLowerCase().includes("avok"));
      expect(offenders, `${rel} puts a vendor name in a string literal: ${offenders.join(", ")}`).toEqual([]);
    }
  });

  it("pins the exact wire values (changing these changes every existing wallet's address)", () => {
    expect(HKDF_SALT).toBe("passkey-access-vault/hkdf-salt/v0");
    expect(WALLET_INFO).toBe("passkey-access-vault/wallet-key/v0");
  });

  it("pins the PRF salt — changing it changes every K, i.e. every wallet becomes a different wallet", () => {
    // This is the FIRST input to the chain (PRF = authenticator(salt); K = HKDF(PRF)), so it is the
    // single most load-bearing constant in the standard. Frozen once real users hold value.
    expect(new TextDecoder().decode(getPrfSalt())).toBe("passkey-access-vault/prf-salt/v0");
  });
});
