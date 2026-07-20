import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { AvokProvider } from "../src/provider.js";
import { usePairingCeremony, type PairingCeremony } from "../src/pairing.js";

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
    mintAndWrap: vi.fn().mockResolvedValue({ qr: "WRAP", sas: "123456" }),
  },
  holder: {
    invite: vi.fn().mockResolvedValue({ qr: "INVITE" }),
    receiveWrap: vi.fn().mockResolvedValue({ sas: "123456" }),
    complete: vi.fn(),
  },
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
  it("scans the invite and shows its wrap", async () => {
    // The enroller now SCANS first and shows nothing until it has the invite — the inversion the
    // two-round ceremony introduced.
    //
    // That changes the FIRST observable. Previously the enroller showed a code immediately, which
    // needed no user action; now its opening move is a scan, and scans are gated behind a tap (a
    // device cannot detect that the other one scanned its screen). So the ceremony correctly parks at
    // `prompt-scan` with nothing shown, waiting for the user to open the camera.
    transport.scanCode.mockReturnValue(new Promise(() => {})); // never resolves
    render(wrap(<Harness role="import" />));
    await waitFor(() => {
      expect(captured.phase).toBe("prompt-scan");
    });
    expect(transport.showCode).not.toHaveBeenCalled();
  });

  it("reaches the SAS gate after a scan, and confirmSas(false) rejects the ceremony", async () => {
    transport.scanCode.mockResolvedValue("INVITE");
    render(wrap(<Harness role="import" />));

    // Poll triggerScan until the tap-gated scan advances and the ceremony reaches the SAS gate.
    await waitFor(() => {
      captured.triggerScan();
      expect(captured.phase).toBe("sas");
    });
    expect(captured.sas).toBe("123456");
    expect(pairing.enroller.mintAndWrap).toHaveBeenCalledWith("INVITE");

    act(() => captured.confirmSas(false));
    await waitFor(() => expect(captured.phase).toBe("rejected"));
    // The credential is already minted by this point — that is the trade for the shorter
    // ceremony. What must NOT happen is the holder sealing K, which is asserted on that side.
  });

  it("a blocked camera surfaces a camera-error phase that retryCamera clears", async () => {
    transport.scanCode
      .mockRejectedValueOnce(new FakeCameraUnavailable())
      .mockResolvedValueOnce("INVITE");
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
