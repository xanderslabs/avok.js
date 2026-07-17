/**
 * Test fixture: builds a real PRF-wrapped EncryptedKeyBlob with known keys.
 * Used by sandbox tests that need a concrete blob + prfOutput without going through createWallet.
 */
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { encryptKeyBlob, serializeBlob } from "../crypto/blob.js";
import { produceSolanaKey, type SecretContainer } from "../crypto/container.js";

const FIXED_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
// base64url of "blob-fixture-cred-001"
const FIXED_CRED_ID = "YmxvYi1maXh0dXJlLWNyZWQtMDAx";
const FIXED_PRF = new Uint8Array(32).fill(0xab);

export interface ContainerBlobFixture {
  bytes: Uint8Array;
  prfOutput: ArrayBuffer;
  solanaAddress: string;
  evmAddress: string;
  credentialId: string;
}

export async function makeContainerBlob(): Promise<ContainerBlobFixture> {
  const evmAddress = privateKeyToAccount(FIXED_KEY).address;
  const container: SecretContainer = { key: hexToBytes(FIXED_KEY) };
  const solanaPublicKey = ed25519.getPublicKey(produceSolanaKey(container));
  const solanaAddress = base58.encode(solanaPublicKey);
  const prfOutput = FIXED_PRF.slice().buffer as ArrayBuffer;

  const blob = await encryptKeyBlob({
    container,
    address: evmAddress,
    credentialId: FIXED_CRED_ID,
    prfOutput,
  });

  return {
    bytes: serializeBlob(blob),
    prfOutput,
    solanaAddress,
    evmAddress,
    credentialId: FIXED_CRED_ID,
  };
}
