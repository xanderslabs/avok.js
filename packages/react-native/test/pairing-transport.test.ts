import { describe, it, expect, vi } from "vitest";
import { CameraUnavailableError } from "@avokjs/core/helpers";
import { createExpoCameraTransport } from "../src/pairing-transport.js";

describe("createExpoCameraTransport (injected camera)", () => {
  it("exposes the PairingTransport interface plus the RN wiring points", () => {
    const t = createExpoCameraTransport({ requestCameraPermissionsAsync: vi.fn() });
    expect(typeof t.showCode).toBe("function");
    expect(typeof t.scanCode).toBe("function");
    expect(typeof t.stop).toBe("function");
    expect(typeof t.feedBarcode).toBe("function");
    expect(t.currentCode).toBeNull();
    expect(t.isScanning).toBe(false);
  });

  it("showCode records the code for the app to render", () => {
    const t = createExpoCameraTransport({ requestCameraPermissionsAsync: vi.fn() });
    t.showCode("REQ-QR");
    expect(t.currentCode).toBe("REQ-QR");
  });

  it("scanCode resolves when a barcode is fed in, and flips isScanning", async () => {
    const camera = { requestCameraPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }) };
    const t = createExpoCameraTransport(camera);
    t.showCode("SHOWN");
    const scan = t.scanCode();
    await vi.waitFor(() => expect(t.isScanning).toBe(true));
    expect(t.currentCode).toBeNull(); // scanning hides any shown code
    t.feedBarcode("SCANNED-DATA");
    await expect(scan).resolves.toBe("SCANNED-DATA");
    expect(t.isScanning).toBe(false);
  });

  it("throws CameraUnavailableError when permission is denied (a retryable camera-error)", async () => {
    const camera = { requestCameraPermissionsAsync: vi.fn().mockResolvedValue({ granted: false }) };
    const t = createExpoCameraTransport(camera);
    await expect(t.scanCode()).rejects.toBeInstanceOf(CameraUnavailableError);
  });

  it("stop() clears pending scan + shown code", () => {
    const t = createExpoCameraTransport({ requestCameraPermissionsAsync: vi.fn() });
    t.showCode("X");
    t.stop();
    expect(t.currentCode).toBeNull();
    expect(t.isScanning).toBe(false);
  });
});
