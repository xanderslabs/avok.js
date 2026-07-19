import { describe, it, expect } from "vitest";
import QRCode from "qrcode";
import jsQRImport from "jsqr";

// jsqr's default export is the decode function; pin the callable type (see src/qr.ts).
const jsQR = jsQRImport as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

// Render a QR to a raw RGBA pixel buffer WITHOUT a native canvas: QRCode.create gives the module
// matrix; we paint each dark module as a black block over a white quiet zone, then decode with
// jsQR. This round-trips the real encode→decode path (a payload-size regression guard) with no
// native deps — the live camera scan is founder-tested separately.
function renderToImageData(text: string, scale = 8, quiet = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const bits = qr.modules.data; // Uint8Array, 1 = dark module
  const dim = (size + quiet * 2) * scale;
  const buf = new Uint8ClampedArray(dim * dim * 4).fill(255); // white
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!bits[y * size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (quiet + x) * scale + dx;
          const py = (quiet + y) * scale + dy;
          const idx = (py * dim + px) * 4;
          buf[idx] = 0;
          buf[idx + 1] = 0;
          buf[idx + 2] = 0;
          buf[idx + 3] = 255;
        }
      }
    }
  }
  return { data: buf, width: dim, height: dim };
}

describe("QR round-trips the pairing payloads", () => {
  it("encodes and decodes a grant-sized base64url string exactly", () => {
    // Representative grant payload: {v,kind,iv,ct} base64url — ~220 chars.
    const payload =
      "eyJ2Ijo0LCJraW5kIjoiZ3JhbnQiLCJpdiI6IkFBQUFBQUFBQUFBQSJ9" +
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".repeat(2) +
      "eyJhY2siOiJ0ZXN0In0";
    const img = renderToImageData(payload);
    const decoded = jsQR(img.data, img.width, img.height);
    expect(decoded?.data).toBe(payload);
  });
});
