/**
 * RN usePairingCeremony test. The hook is pure React (no react-native, no native modules) driving the
 * platform-agnostic ceremony over an INJECTED transport, so @testing-library/react + jsdom suffice —
 * exactly as the provider/hooks tests do. The real CameraUnavailableError comes from
 * @avokjs/core/helpers (DOM-free), so no module mocking is needed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { CameraUnavailableError, type PairingTransport } from "@avokjs/core/helpers";
import { AvokProvider } from "../src/provider.js";
import { usePairingCeremony, type PairingCeremony } from "../src/pairing.js";

const pairing = {
  enroller: {
    mintAndWrap: vi.fn().mockResolvedValue({ qr: "WRAP", sas: "654321" }),
  },
  holder: {
    invite: vi.fn().mockResolvedValue({ qr: "INVITE" }),
    receiveWrap: vi.fn().mockResolvedValue({ sas: "123456" }),
    complete: vi.fn(),
  },
};
const client = {
  custody: "self",
  enrollAccessSlot: { viaPairing: pairing },
  account: () => null,
  status: () => false,
  subscribe: () => () => {},
  login: vi.fn().mockResolvedValue({}),
} as unknown as Parameters<typeof AvokProvider>[0]["client"];

let captured: PairingCeremony;
function Harness({ transport }: { transport: PairingTransport }) {
  captured = usePairingCeremony({ role: "import", transport });
  return null;
}
const wrap = (children: ReactNode) => <AvokProvider client={client}>{children}</AvokProvider>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePairingCeremony (react-native, injected transport)", () => {
  it("drives the ceremony over the injected transport, scanning before it shows anything", async () => {
    // The enroller's opening move is a SCAN now — it has nothing to say until the invite tells it
    // which wallet it is joining. Parking the scan proves nothing is shown before that.
    const transport: PairingTransport = {
      showCode: vi.fn(),
      scanCode: vi.fn(() => new Promise<string>(() => {})),
      stop: vi.fn(),
    };
    render(wrap(<Harness transport={transport} />));
    // Scans are tap-gated (a device cannot detect that the other one scanned its screen), so the
    // ceremony parks on the camera prompt with nothing shown until the user acts.
    await waitFor(() => expect(captured.phase).toBe("prompt-scan"));
    expect(transport.showCode).not.toHaveBeenCalled();
  });

  it("reaches the SAS gate after a scan; confirmSas(false) rejects", async () => {
    const transport: PairingTransport = {
      showCode: vi.fn(),
      scanCode: vi.fn().mockResolvedValue("INVITE"),
      stop: vi.fn(),
    };
    render(wrap(<Harness transport={transport} />));

    await waitFor(() => {
      captured.triggerScan();
      expect(captured.phase).toBe("sas");
    });
    expect(captured.sas).toBe("654321");

    act(() => captured.confirmSas(false));
    await waitFor(() => expect(captured.phase).toBe("rejected"));
    // The credential is already minted by this point — that is the trade the shorter ceremony makes,
    // and why a mismatch BURNS it. What must not happen is the holder sealing K, asserted on that side.
    expect(pairing.enroller.mintAndWrap).toHaveBeenCalled();
  });

  it("surfaces a blocked camera and clears it on retryCamera", async () => {
    const scanCode = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new CameraUnavailableError())
      .mockResolvedValueOnce("INVITE");
    const transport: PairingTransport = { showCode: vi.fn(), scanCode, stop: vi.fn() };
    render(wrap(<Harness transport={transport} />));

    await waitFor(() => {
      captured.triggerScan();
      expect(captured.phase).toBe("camera-error");
    });
    act(() => captured.retryCamera());
    await waitFor(() => expect(captured.phase).toBe("sas"));
  });
});
