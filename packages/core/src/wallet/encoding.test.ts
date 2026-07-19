import { describe, expect, test } from "vitest";
import { base64UrlToBytes, bytesToArrayBuffer, bytesToBase64Url } from "./encoding.js";

describe("encoding", () => {
  test("base64url round-trips arbitrary bytes without padding", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect([...base64UrlToBytes(encoded)]).toEqual([...bytes]);
  });

  test("bytesToArrayBuffer returns a buffer sized exactly to the view", () => {
    const view = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
    const buffer = bytesToArrayBuffer(view);
    expect(buffer.byteLength).toBe(2);
    expect([...new Uint8Array(buffer)]).toEqual([2, 3]);
  });
});
