import { deriveSolanaKey } from "./derive.js";

/**
 * The wallet secret. Exactly one 32-byte key K; both chains derive from it.
 *
 * K is held as raw, MUTABLE bytes — never a `Hex` string — for one reason: a JavaScript string is
 * immutable and cannot be overwritten, so it lingers in the heap until GC, uncollectable on demand.
 * A `Uint8Array` can be zeroed in place (`key.fill(0)`), which is what "derive, use, and clear"
 * requires. The sandbox owns each container's lifetime and wipes `key` after use.
 */
export type SecretContainer = { key: Uint8Array };

export function assertContainerComplete(c: SecretContainer): void {
  if (!c?.key || c.key.length === 0) throw new Error("Secret container has no key");
}

/** The blob/pairing plaintext IS the raw 32 key bytes — no JSON, no text encoding. */
export function serializeContainer(c: SecretContainer): Uint8Array {
  assertContainerComplete(c);
  return c.key;
}

/** Rebuild a container from decrypted plaintext bytes. Copies so the caller may wipe its source. */
export function deserializeContainer(bytes: Uint8Array): SecretContainer {
  const key = Uint8Array.from(bytes);
  assertContainerComplete({ key });
  return { key };
}

/** K is the EVM private key directly — the same 32 bytes. */
export function produceEvmKey(c: SecretContainer): Uint8Array {
  assertContainerComplete(c);
  return c.key;
}

/** The Solana ed25519 secret bytes, derived from K so both credentials reach the same keypair. */
export function produceSolanaKey(c: SecretContainer): Uint8Array {
  assertContainerComplete(c);
  return deriveSolanaKey(c.key).secretKey;
}
