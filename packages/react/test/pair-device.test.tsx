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
  enroller: { mintAndWrap: vi.fn().mockResolvedValue({ qr: "WRAP", sas: "123456" }) },
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
    // The enroller's opening move is now a SCAN, not a display — it has nothing to say until it knows
    // which wallet it is joining. Scans are tap-gated (a device cannot detect that the other one
    // scanned its screen), so the component parks on the camera prompt for the `await-invite` step.
    await waitFor(() => expect(container.textContent).toMatch(/scan the code shown on your existing device/i));
  });
});
