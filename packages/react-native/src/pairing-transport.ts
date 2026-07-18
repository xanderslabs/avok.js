/**
 * createExpoCameraTransport — a PairingTransport for React Native, over an INJECTED expo-camera module.
 *
 * WHY A BRIDGE, NOT A DROP-IN. expo-camera's live scanning is render-driven (`<CameraView
 * onBarcodeScanned>`), and QR *display* is app-rendered too — neither is an imperative call. A
 * self-contained transport would therefore have to import `react-native`, which is exactly what this
 * package must never do (all native modules are injected; the graph stays DOM-free and buildable with
 * nothing native installed). So this helper owns the parts that ARE imperative — the camera permission
 * request, and the barcode-event → `scanCode()` promise bridge, plus the scan/show state — and exposes
 * wiring the app connects to its own views:
 *
 *   const t = createExpoCameraTransport(Camera);          // Camera = your injected expo-camera module
 *   usePairingCeremony({ role, transport: t });
 *   // render, from t.currentCode / t.isScanning:
 *   //   t.currentCode  → an <Image>/QR of the code to show
 *   //   t.isScanning   → <CameraView onBarcodeScanned={e => t.feedBarcode(e.data)} />
 *
 * `expo-camera` is NOT a dependency of this package — only its permission API shape is referenced, and
 * it is passed in. A dev on a different camera lib writes their own PairingTransport against the same
 * interface. Device-gated: a real camera is exercised only on-device (see VERIFICATION.md).
 */
import { CameraUnavailableError, type PairingTransport } from "@avokjs/core/helpers";

/** The sliver of the expo-camera module this adapter calls imperatively. Injected, never imported. */
export interface ExpoCameraLike {
  requestCameraPermissionsAsync(): Promise<{ granted: boolean }>;
}

export interface ExpoCameraTransport extends PairingTransport {
  /** The code to display right now (a pairing QR payload), or null. The app renders a QR of it. */
  readonly currentCode: string | null;
  /** True while a scan is awaited — the app should mount its <CameraView> and forward barcodes. */
  readonly isScanning: boolean;
  /** Feed a scanned barcode's data in (from <CameraView onBarcodeScanned>). Resolves the pending scan. */
  feedBarcode(data: string): void;
}

export function createExpoCameraTransport(camera: ExpoCameraLike): ExpoCameraTransport {
  let currentCode: string | null = null;
  let scanning = false;
  let pending: ((data: string) => void) | null = null;

  return {
    get currentCode() {
      return currentCode;
    },
    get isScanning() {
      return scanning;
    },

    showCode(code: string): void {
      currentCode = code;
    },

    async scanCode(): Promise<string> {
      // Permission is the one imperative thing expo-camera exposes; a denial is a retryable
      // camera-error the ceremony hook narrows on (same class the browser transport throws).
      const { granted } = await camera.requestCameraPermissionsAsync();
      if (!granted) throw new CameraUnavailableError();
      scanning = true;
      currentCode = null; // a scan hides any code we were showing
      return new Promise<string>((resolve) => {
        pending = (data) => {
          scanning = false;
          pending = null;
          resolve(data);
        };
      });
    },

    feedBarcode(data: string): void {
      pending?.(data);
    },

    stop(): void {
      currentCode = null;
      scanning = false;
      pending = null;
    },
  };
}
