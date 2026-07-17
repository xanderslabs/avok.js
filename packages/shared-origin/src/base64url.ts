/**
 * Safe base64url encoding for raw bytes.
 *
 * Builds the binary string with a loop instead of spreading the Uint8Array into
 * String.fromCharCode(...bytes), which can overflow the JS call-stack arg limit
 * for large buffers (typically >65 536 elements on V8/JSC).
 *
 * Output: RFC 4648 §5 base64url, no padding ("+" → "-", "/" → "_", "=" stripped).
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Decode RFC 4648 §5 base64url (no padding) back to raw bytes. */
export function bytesFromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
