// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { attemptPopupOpen, renderPopupRetryPrompt } from "../../src/channel/popup-open.js";

function fakeWindow(): Window {
  return {} as Window;
}

describe("attemptPopupOpen", () => {
  it("reports opened when window.open returns a window", () => {
    const popup = fakeWindow();
    const outcome = attemptPopupOpen(() => popup);
    expect(outcome).toEqual({ status: "opened", popup });
  });

  it("reports blocked when window.open returns null", () => {
    const outcome = attemptPopupOpen(() => null);
    expect(outcome).toEqual({ status: "blocked" });
  });
});

describe("renderPopupRetryPrompt: popup-null path renders retry", () => {
  it("renders a gesture-bound retry control after the initial open was blocked", () => {
    const root = document.createElement("div");
    void renderPopupRetryPrompt(root, () => null);

    expect(root.textContent).toContain("blocked the wallet popup");
    const button = root.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.textContent).toContain("Continue in your wallet");
  });

  it("stays up (does not resolve) when the retry click is blocked again", async () => {
    const root = document.createElement("div");
    const onResolve = vi.fn();
    renderPopupRetryPrompt(root, () => null).then(onResolve);

    root.querySelector("button")!.click();
    await Promise.resolve();

    expect(onResolve).not.toHaveBeenCalled();
    // The prompt is still there for another attempt.
    expect(root.querySelector("button")).not.toBeNull();
  });

  it("resolves with the popup once a retry click succeeds", async () => {
    const root = document.createElement("div");
    const popup = fakeWindow();

    const resolved = renderPopupRetryPrompt(root, () => popup);
    root.querySelector("button")!.click();

    await expect(resolved).resolves.toBe(popup);
  });

  it("keeps retrying across multiple blocked clicks until one succeeds", async () => {
    const root = document.createElement("div");
    const popup = fakeWindow();
    let attempts = 0;
    const open = () => {
      attempts += 1;
      return attempts < 3 ? null : popup;
    };

    const resolved = renderPopupRetryPrompt(root, open);
    const button = root.querySelector("button")!;
    button.click();
    button.click();
    button.click();

    await expect(resolved).resolves.toBe(popup);
  });
});
