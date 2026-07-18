import { type Address, bytesToHex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { base58 } from "@scure/base";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { HDKey } from "micro-key-producer/slip10.js";

/** The EVM address for a private key given as raw bytes. Derives the public key with @noble/curves
 *  so no `Hex` private-key string is ever constructed — the address itself is public. */
export function evmAddress(privateKey: Uint8Array): Address {
  return publicKeyToAddress(bytesToHex(secp256k1.getPublicKey(privateKey, false)));
}

/** Solana ed25519 via SLIP-0010 m/44'/501'/0'/0'. `entropy` is K's raw bytes; secretKey is the
 *  32-byte ed25519 seed.
 *
 *  The BIP-39 mnemonic here is an INTERNAL step of SLIP-0010 — never a user-facing recovery phrase.
 *  Nothing a user holds can be restored from these words; K comes from the passkey's PRF. */
export function deriveSolanaKey(entropy: Uint8Array): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const seed = mnemonicToSeedSync(entropyToMnemonic(entropy, wordlist));
  const secretKey = HDKey.fromMasterSeed(seed).derive("m/44'/501'/0'/0'").privateKey;
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

export function solanaAddressFromSecret(solanaKey: Uint8Array): string {
  return base58.encode(ed25519.getPublicKey(solanaKey));
}
