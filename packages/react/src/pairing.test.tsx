import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { AvokProvider } from "./provider.js";
import { usePairingCeremony, type PairingCeremony } from "./pairing.js";

// A controllable browser QR transport. The hook drives the REAL runImport/ExportCeremony against this
// fake, so the phase machine (tap-gating, camera-error, SAS gate) is exercised without a real camera.
// vi.hoisted: the mock factory is hoisted above imports, so its shared values must be too.
const { transport, FakeCameraUnavailable } = vi.hoisted(() => {
  class FakeCameraUnavailable extends Error {}
  return {
    transport: { showCode: vi.fn(), scanCode: vi.fn<() => Promise<string>>(), stop: vi.fn() },
    FakeCameraUnavailable,
  };
});
vi.mock("@avokjs/core/qr", () => ({
  createBrowserQrTransport: () => transport,
  CameraUnavailableError: FakeCameraUnavailable,
}));

const pairing = {
  enroller: {
    begin: vi.fn().mockResolvedValue({ qr: "REQ" }),
    receiveAck: vi.fn().mockResolvedValue({ sas: "123456" }),
    enroll: vi.fn().mockResolvedValue({ qr: "WRAP" }),
  },
  holder: { authorize: vi.fn(), complete: vi.fn() },
};
const login = vi.fn().mockResolvedValue({});
const client = {
  custody: "self",
  enrollAccessSlot: { viaPairing: pairing },
  account: () => null,
  status: () => false,
  subscribe: () => () => {},
  login,
} as unknown as Parameters<typeof AvokProvider>[0]["client"];

let captured: PairingCeremony;
function Harness({ role }: { role: "import" | "export" }) {
  const c = usePairingCeremony({ role });
  captured = c;
  return (
    <div>
      <div ref={c.qrRef} />
      <video ref={c.videoRef} />
    </div>
  );
}
const wrap = (children: ReactNode) => <AvokProvider client={client}>{children}</AvokProvider>;

beforeEach(() => {
  transport.scanCode.mockReset();
  transport.showCode.mockReset();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePairingCeremony (import / enroller)", () => {
  it("begins the ceremony and shows the request QR", async () => {
    transport.scanCode.mockReturnValue(new Promise(() => {})); // never resolves — park at scan-ack
    render(wrap(<Harness role="import" />));
    await waitFor(() => {
      expect(pairing.enroller.begin).toHaveBeenCalled();
      expect(transport.showCode).toHaveBeenCalledWith("REQ");
    });
  });

  it("reaches the SAS gate after a scan, and confirmSas(false) rejects the ceremony", async () => {
    transport.scanCode.mockResolvedValue("ACK");
    render(wrap(<Harness role="import" />));

    // Poll triggerScan until the tap-gated scan advances and the ceremony reaches the SAS gate.
    await waitFor(() => {
      captured.triggerScan();
      expect(captured.phase).toBe("sas");
    });
    expect(captured.sas).toBe("123456");
    expect(pairing.enroller.receiveAck).toHaveBeenCalledWith("ACK");

    act(() => captured.confirmSas(false));
    await waitFor(() => expect(captured.phase).toBe("rejected"));
    expect(pairing.enroller.enroll).not.toHaveBeenCalled(); // never asserts sasConfirmed on a reject
  });

  it("a blocked camera surfaces a camera-error phase that retryCamera clears", async () => {
    transport.scanCode
      .mockRejectedValueOnce(new FakeCameraUnavailable())
      .mockResolvedValueOnce("ACK");
    render(wrap(<Harness role="import" />));

    await waitFor(() => {
      captured.triggerScan();
      expect(captured.phase).toBe("camera-error");
    });
    act(() => captured.retryCamera());
    // After retry the scan succeeds and the ceremony advances past the camera error to the SAS gate.
    await waitFor(() => expect(captured.phase).toBe("sas"));
  });
});
