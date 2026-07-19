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
import { AvokProvider } from "./provider.js";
import { usePairingCeremony, type PairingCeremony } from "./pairing.js";

const pairing = {
  enroller: {
    begin: vi.fn().mockResolvedValue({ qr: "REQ" }),
    receiveAck: vi.fn().mockResolvedValue({ sas: "654321" }),
    enroll: vi.fn().mockResolvedValue({ qr: "WRAP" }),
  },
  holder: { authorize: vi.fn(), complete: vi.fn() },
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
  it("drives the ceremony over the injected transport and shows the request code", async () => {
    const transport: PairingTransport = { showCode: vi.fn(), scanCode: vi.fn(() => new Promise<string>(() => {})), stop: vi.fn() };
    render(wrap(<Harness transport={transport} />));
    await waitFor(() => {
      expect(pairing.enroller.begin).toHaveBeenCalled();
      expect(transport.showCode).toHaveBeenCalledWith("REQ");
    });
  });

  it("reaches the SAS gate after a scan; confirmSas(false) rejects", async () => {
    const transport: PairingTransport = { showCode: vi.fn(), scanCode: vi.fn().mockResolvedValue("ACK"), stop: vi.fn() };
    render(wrap(<Harness transport={transport} />));

    await waitFor(() => {
      captured.triggerScan();
      expect(captured.phase).toBe("sas");
    });
    expect(captured.sas).toBe("654321");

    act(() => captured.confirmSas(false));
    await waitFor(() => expect(captured.phase).toBe("rejected"));
    expect(pairing.enroller.enroll).not.toHaveBeenCalled();
  });

  it("surfaces a blocked camera and clears it on retryCamera", async () => {
    const scanCode = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new CameraUnavailableError())
      .mockResolvedValueOnce("ACK");
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
