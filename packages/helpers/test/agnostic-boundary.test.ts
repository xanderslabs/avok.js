import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// The `.` entry must stay platform-neutral so React Native / Node consumers can use it. All
// DOM/camera/QR code lives ONLY in the `./qr` entry (dist/qr.js). If a browser symbol leaks into
// dist/index.js, this fails — the same spirit as the .d.ts self-containment guards elsewhere.
describe("agnostic entry stays platform-neutral", () => {
  it("dist/index.js references no DOM/camera/QR symbols (RN-safe)", () => {
    const js = readFileSync(join(__dirname, "../dist/index.js"), "utf8");
    for (const banned of ["getUserMedia", "mediaDevices", "document.createElement", "jsQR", "requestAnimationFrame"]) {
      expect(js).not.toContain(banned);
    }
  });
});
