import { type Address, bytesToHex, stringToBytes } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { base58 } from "@scure/base";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { HKDF_SALT, SOLANA_KEY_INFO } from "./derive-wallet.js";

/** The EVM address for a private key given as raw bytes. Derives the public key with @noble/curves
 *  so no `Hex` private-key string is ever constructed — the address itself is public. */
export function evmAddress(privateKey: Uint8Array): Address {
  return publicKeyToAddress(bytesToHex(secp256k1.getPublicKey(privateKey, false)));
}

/** Solana ed25519 secret derived from the wallet key K by HKDF-SHA256 (domain SOLANA_KEY_INFO). `key`
 *  is K's raw bytes; the 32-byte output IS the ed25519 seed, so both the primary and any access-key
 *  credential reach the same keypair.
 *
 *  HKDF keeps K's entropy in raw BYTES the whole way — unlike the old BIP-39 → SLIP-0010 path, no
 *  mnemonic STRING is ever minted, and a string cannot be zeroed (see crypto/container.ts). The words
 *  were never user-facing anyway; nothing a user holds could restore them. */
export function deriveSolanaKey(key: Uint8Array): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const secretKey = hkdf(sha256, key, stringToBytes(HKDF_SALT), stringToBytes(SOLANA_KEY_INFO), 32);
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

export function solanaAddressFromSecret(solanaKey: Uint8Array): string {
  return base58.encode(ed25519.getPublicKey(solanaKey));
}
