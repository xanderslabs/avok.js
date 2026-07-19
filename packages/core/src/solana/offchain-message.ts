import { sha256 } from "@noble/hashes/sha2.js";

const SIGNING_DOMAIN = new Uint8Array([0xff, ...new TextEncoder().encode("solana offchain")]); // 16 bytes

/** Solana wallet-standard off-chain message envelope version. Only v0 is emitted today; named as an
 *  explicit discriminant (mirroring the EVM blob's version field) so a future v1 is a deliberate,
 *  greppable change and any decode/verify site can assert the version it expects rather than assume it. */
export const OFFCHAIN_MESSAGE_VERSION = 0 as const;

function isPrintableAscii(bytes: Uint8Array): boolean {
  for (const b of bytes) if (b < 0x20 || b > 0x7e) return false;
  return true;
}

/** Full Solana wallet-standard v0 off-chain message envelope.
 *  application_domain = sha256(rpId) — derived internally so both signing sites stay byte-identical. */
export function encodeOffchainMessage({ message, rpId }: { message: string; rpId: string }): Uint8Array {
  const msg = new TextEncoder().encode(message);
  if (msg.length > 0xffff) throw new Error("Off-chain message exceeds 65535 bytes");
  const appDomain = sha256(new TextEncoder().encode(rpId)); // 32 bytes
  const format = isPrintableAscii(msg) ? 0 : 2;
  const out = new Uint8Array(SIGNING_DOMAIN.length + 1 + 32 + 1 + 2 + msg.length);
  let o = 0;
  out.set(SIGNING_DOMAIN, o);
  o += SIGNING_DOMAIN.length;
  out[o++] = OFFCHAIN_MESSAGE_VERSION; // envelope version (wallet-standard v0)
  out.set(appDomain, o);
  o += 32; // application domain
  out[o++] = format; // message format
  out[o++] = msg.length & 0xff; // length u16 LE
  out[o++] = (msg.length >> 8) & 0xff;
  out.set(msg, o);
  return out;
}
