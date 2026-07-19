import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { AvokProvider } from "../src/provider.js";
import { PairDevice } from "../src/pair-device.js";

const { transport } = vi.hoisted(() => ({
  transport: { showCode: vi.fn(), scanCode: vi.fn<() => Promise<string>>(() => new Promise(() => {})), stop: vi.fn() },
}));
vi.mock("@avokjs/core/qr", () => ({
  createBrowserQrTransport: () => transport,
  CameraUnavailableError: class extends Error {},
}));

const pairing = {
  enroller: { begin: vi.fn().mockResolvedValue({ qr: "REQ" }), receiveAck: vi.fn(), enroll: vi.fn() },
  holder: { authorize: vi.fn(), complete: vi.fn() },
};
const client = {
  custody: "self",
  enrollAccessSlot: { viaPairing: pairing },
  account: () => null,
  status: () => false,
  subscribe: () => () => {},
  login: vi.fn(),
} as unknown as Parameters<typeof AvokProvider>[0]["client"];

afterEach(cleanup);

describe("<PairDevice>", () => {
  it("renders inside a self-custody provider and starts the import ceremony", async () => {
    const { container } = render(
      <AvokProvider client={client}>
        <PairDevice role="import" />
      </AvokProvider>,
    );
    expect(container).toBeTruthy();
    await waitFor(() => expect(pairing.enroller.begin).toHaveBeenCalled());
    expect(transport.showCode).toHaveBeenCalledWith("REQ");
    // With the request code up and the ceremony parked at the scan step, the tap-to-scan control shows.
    await waitFor(() => expect(container.textContent).toMatch(/scan their reply/i));
  });
});
