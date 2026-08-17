import { type Address, bytesToHex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";

/** The EVM address for a private key given as raw bytes. Derives the public key with @noble/curves
 *  so no `Hex` private-key string is ever constructed — the address itself is public. */
export function evmAddress(privateKey: Uint8Array): Address {
  return publicKeyToAddress(bytesToHex(secp256k1.getPublicKey(privateKey, false)));
}
