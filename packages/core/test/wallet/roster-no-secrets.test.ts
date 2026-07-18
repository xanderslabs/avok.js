import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { Address, Hex } from "viem";
import { listAccessSlots } from "../../src/wallet/roster.js";

/**
 * THE ROSTER / REMOVAL SURFACE MUST NEVER HANDLE SECRET MATERIAL.
 *
 * Listing a wallet's access slots and removing one are built ENTIRELY on public data: the wallet address,
 * slot ids, credential ids, and enrollment dates. The PRF output, the wallet key K, and any decrypted
 * container are never needed here and must never be threaded through — every place a secret is held
 * is a place it can leak, and this surface is meant to hold none.
 *
 * These guards fail loudly if a future refactor quietly routes a secret through the roster logic
 * (source scan) or the access-slot records it exposes (shape check). Source-scan guards are an established
 * pattern in this repo.
 */
const SECRET_BEARING = [
  "prfOutput",
  "deriveWalletKey",
  "walletKey",
  "SecretContainer",
  "withWalletKey",
  "withSolanaKey",
  "withDecryptedContainer",
  "decryptKeyBlob",
  "encryptKeyBlob",
  "privateKey",
  "exportWallet",
] as const;

describe("the roster/removal surface never handles secret material", () => {
  test("roster.ts references no secret-bearing API", () => {
    const src = readFileSync(join(import.meta.dirname, "../../src/wallet/roster.ts"), "utf8");
    for (const forbidden of SECRET_BEARING) {
      expect(src, `roster.ts must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  test("vault.ts (the call builders) references no secret-bearing API", () => {
    // buildAddAccessSlotCall / buildRemoveAccessSlotCall assemble on-chain calls from public args.
    const src = readFileSync(join(import.meta.dirname, "../../src/wallet/vault.ts"), "utf8");
    for (const forbidden of SECRET_BEARING) {
      expect(src, `vault.ts must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  test("an access-slot record (AccessSlotEntry) carries only public fields", async () => {
    const [entry] = await listAccessSlots({
      address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" as Address,
      reader: {
        getAccessSlotIds: async () => [`0x${"11".repeat(32)}` as Hex],
        getAccessSlotAddedAt: async () => 1,
        getAccessSlotMeta: async () => new Uint8Array(0),
      },
    });
    // If a secret-looking field ever appears here, this fails — an access slot must never carry key material.
    // `encryptedMeta` is NOT a secret: it is opaque AES-GCM output that lands publicly on chain, and
    // reading it requires K, which the listing never touches. The decrypt step lives in roster-meta.ts.
    expect(Object.keys(entry).sort()).toEqual(["addedAt", "encryptedMeta", "isThisDevice", "slotId"]);
  });
});
