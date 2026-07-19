// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createDomView } from "../../src/auth-popup/view-dom.js";

// jsdom reflects programmatic `el.style.x = …` into a `style` attribute on the LIVE element, so we do
// not assert "no style attribute" here (that would fail on a testing artifact). The real CSP guarantee
// — that the SERVED html carries no inline styles the CSP must admit — is enforced on the emitted page
// by auth-popup/scripts/verify-inlined.mjs (Task 4). These tests cover the view's BEHAVIOR.
describe("createDomView", () => {
  it("connecting / waitingForPasskey / failure render their text", () => {
    const root = document.createElement("div");
    const view = createDomView(root);
    view.connecting();
    expect(root.textContent).toContain("Signing you in");
    view.waitingForPasskey();
    expect(root.textContent).toContain("Waiting for passkey");
    view.failure("boom");
    expect(root.textContent).toContain("Sign-in failed: boom");
  });

  it("showConsent renders the lines and resolves true on Approve", async () => {
    const root = document.createElement("div");
    const view = createDomView(root);
    const p = view.showConsent(["Sign message:", "hello"]);
    expect(root.textContent).toContain("hello");
    const approve = [...root.querySelectorAll("button")].find((b) => /approve/i.test(b.textContent ?? ""));
    approve!.click();
    await expect(p).resolves.toBe(true);
  });

  it("showConsent resolves false on Reject", async () => {
    const root = document.createElement("div");
    const view = createDomView(root);
    const p = view.showConsent(["Sign message:", "hello"]);
    const reject = [...root.querySelectorAll("button")].find((b) => /reject/i.test(b.textContent ?? ""));
    reject!.click();
    await expect(p).resolves.toBe(false);
  });

  it("rejectOnly renders a single Close button and resolves false", async () => {
    const root = document.createElement("div");
    const view = createDomView(root);
    const p = view.showConsent(["Can't show you this request…"], { rejectOnly: true });
    const buttons = [...root.querySelectorAll("button")];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toMatch(/close/i);
    buttons[0].click();
    await expect(p).resolves.toBe(false);
  });

  it("surfaces a retry error above the actions", () => {
    const root = document.createElement("div");
    const view = createDomView(root);
    void view.showConsent(["Sign message:", "hello"], { error: "passkey dismissed" });
    expect(root.textContent).toContain("Error: passkey dismissed");
  });
});
