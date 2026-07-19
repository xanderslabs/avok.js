import QRCode from "qrcode";
import jsQRImport from "jsqr";
import type { PairingTransport } from "./pairing.js";

// jsqr ships `export default jsQR` (a decode function). Some .d.ts bundlers resolve the default to
// the module namespace (not callable), so pin the callable type explicitly. The runtime value is
// the function (esbuild interop).
const jsQR = jsQRImport as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

// The camera-unavailable signal lives with the platform-agnostic PairingTransport contract (pairing.ts,
// DOM-free) so a React-Native transport can throw the SAME class the ceremony hook narrows on. Re-exported
// here for the browser transport + web consumers that import it from `@avokjs/core/qr`.
export { CameraUnavailableError } from "./pairing.js";
import { CameraUnavailableError } from "./pairing.js";

/**
 * Browser `PairingTransport`: render pairing codes as QRs into `qrContainer`, and scan the other
 * device's QR from the camera into `video`. This is the ONLY browser-locked piece of
 * `@avokjs/helpers` — React Native ships its own transport against the same interface.
 * Requires a secure context (HTTPS or localhost) for `getUserMedia`.
 */
export function createBrowserQrTransport(mounts: {
  qrContainer: HTMLElement;
  video: HTMLVideoElement;
}): PairingTransport {
  let stream: MediaStream | null = null;
  let raf = 0;

  function releaseCamera(): void {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  return {
    showCode(code: string): void {
      const canvas = document.createElement("canvas");
      void QRCode.toCanvas(canvas, code, { errorCorrectionLevel: "M", margin: 1, width: 240 })
        .then(() => mounts.qrContainer.replaceChildren(canvas))
        .catch(() => {
          /* rendering a QR cannot meaningfully fail for these short payloads; ignore */
        });
    },

    async scanCode(): Promise<string> {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch {
        throw new CameraUnavailableError();
      }
      mounts.video.srcObject = stream;
      await mounts.video.play();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      return await new Promise<string>((resolve) => {
        const tick = () => {
          if (mounts.video.readyState >= mounts.video.HAVE_ENOUGH_DATA) {
            canvas.width = mounts.video.videoWidth;
            canvas.height = mounts.video.videoHeight;
            ctx.drawImage(mounts.video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(img.data, img.width, img.height);
            if (found?.data) {
              releaseCamera();
              resolve(found.data);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      });
    },

    stop(): void {
      releaseCamera();
      mounts.qrContainer.replaceChildren();
    },
  };
}
