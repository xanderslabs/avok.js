import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { SharedOrigin } from "../src/shared-origin.js";

// The connection wiring is async (the channel is imported dynamically for bundle purity). Fake both
// halves so the test exercises the fallback → provider transition without a real popup.
const createSharedOriginConnection = vi.fn();
const createAvokClient = vi.fn();
vi.mock("@avokjs/core", async (orig) => {
  const actual = await orig<typeof import("@avokjs/core")>();
  return {
    ...actual,
    createSharedOriginConnection: (...a: unknown[]) => createSharedOriginConnection(...a),
    createAvokClient: (...a: unknown[]) => createAvokClient(...a),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const client = { account: () => null, status: () => false, subscribe: () => () => {} };

describe("<SharedOrigin>", () => {
  it("shows the fallback while wiring, then renders children once the client is ready", async () => {
    createSharedOriginConnection.mockResolvedValue({});
    createAvokClient.mockReturnValue(client);

    render(
      <SharedOrigin auth="https://auth.acme.com" wallet={{ name: "Test Wallet", rdns: "com.test" }} fallback={<p>connecting…</p>}>
        <p>dapp</p>
      </SharedOrigin>,
    );

    expect(screen.getByText("connecting…")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("dapp")).toBeTruthy());
    expect(createSharedOriginConnection).toHaveBeenCalledWith({ authOrigin: "https://auth.acme.com" });
  });

  it("calls onError and keeps showing the fallback if wiring fails", async () => {
    createSharedOriginConnection.mockRejectedValue(new Error("channel blew up"));
    const onError = vi.fn();

    render(
      <SharedOrigin auth="https://auth.acme.com" wallet={{ name: "Test Wallet", rdns: "com.test" }} fallback={<p>connecting…</p>} onError={onError}>
        <p>dapp</p>
      </SharedOrigin>,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "channel blew up" })));
    expect(screen.queryByText("dapp")).toBeNull();
    expect(screen.getByText("connecting…")).toBeTruthy();
  });
});
