import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import type { AuthPopupView } from "@avokjs/core/auth-popup";
import { AuthPopup } from "../src/auth-popup.js";

// vitest runs without `globals`, so testing-library's auto-cleanup afterEach is not registered —
// unmount between tests or each render stacks in the same document.
afterEach(cleanup);

// Capture the view the component hands to the driver, so we can drive it exactly as the real ceremony
// would (connecting / showConsent / waitingForPasskey / failure) without a real opener or WebAuthn.
let capturedView: AuthPopupView | null = null;
vi.mock("@avokjs/core/auth-popup", () => ({
  authPopupDeps: () => ({ readAccount: vi.fn(), signWith: vi.fn(), win: {} }),
  runAuthPopup: (deps: { view: AuthPopupView }) => {
    capturedView = deps.view;
    return () => {};
  },
}));

const config = { operatorName: "Acme", authOrigin: "https://auth.acme.com", rpId: "acme.com", defaultChainId: 10 };

describe("<AuthPopup>", () => {
  it("renders a neutral loading state before any request arrives", () => {
    render(<AuthPopup config={config} />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("renders the connecting state when the driver starts an authorize flow", () => {
    render(<AuthPopup config={config} />);
    act(() => capturedView!.connecting());
    expect(screen.getByText(/signing you in/i)).toBeTruthy();
  });

  it("renders the consent lines and resolves true on Approve", async () => {
    render(<AuthPopup config={config} />);
    let decision: Promise<boolean>;
    act(() => {
      decision = capturedView!.showConsent(["Sign message:", "hello"]);
    });
    expect(screen.getByText(/hello/)).toBeTruthy();
    act(() => screen.getByText("Approve").click());
    await expect(decision!).resolves.toBe(true);
  });

  it("a reject-only request offers only Close and resolves false", async () => {
    render(<AuthPopup config={config} />);
    let decision: Promise<boolean>;
    act(() => {
      decision = capturedView!.showConsent(["Can't show this"], { rejectOnly: true });
    });
    expect(screen.queryByText("Approve")).toBeNull();
    act(() => screen.getByText("Close").click());
    await expect(decision!).resolves.toBe(false);
  });
});
