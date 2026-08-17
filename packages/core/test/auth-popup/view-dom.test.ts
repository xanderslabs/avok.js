// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createDomView } from "../../src/auth-popup/view-dom.js";

// jsdom reflects programmatic `el.style.x = …` into a `style` attribute on the LIVE element, so we do
// not assert "no style attribute" here (that would fail on a testing artifact). The real CSP guarantee
// — that the SERVED html carries no inline styles the CSP must admit — is enforced on the emitted page
// by auth-page/scripts/verify-inlined.mjs (Task 4). These tests cover the view's BEHAVIOR.
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
    const p = view.showConsent([
      { text: "Sign message:", severity: "info" },
      { text: "hello", severity: "info" },
    ]);
    expect(root.textContent).toContain("hello");
    const approve = [...root.querySelectorAll("button")].find((b) => /approve/i.test(b.textContent ?? ""));
    approve!.click();
    await expect(p).resolves.toBe(true);
  });

  it("showConsent resolves false on Reject", async () => {
    const root = document.createElement("div");
    const view = createDomView(root);
    const p = view.showConsent([
      { text: "Sign message:", severity: "info" },
      { text: "hello", severity: "info" },
    ]);
    const reject = [...root.querySelectorAll("button")].find((b) => /reject/i.test(b.textContent ?? ""));
    reject!.click();
    await expect(p).resolves.toBe(false);
  });

  it("rejectOnly renders a single Close button and resolves false", async () => {
    const root = document.createElement("div");
    const view = createDomView(root);
    const p = view.showConsent([{ text: "Can't show you this request…", severity: "info" }], { rejectOnly: true });
    const buttons = [...root.querySelectorAll("button")];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toMatch(/close/i);
    buttons[0].click();
    await expect(p).resolves.toBe(false);
  });

  it("surfaces a retry error above the actions", () => {
    const root = document.createElement("div");
    const view = createDomView(root);
    void view.showConsent(
      [
        { text: "Sign message:", severity: "info" },
        { text: "hello", severity: "info" },
      ],
      { error: "passkey dismissed" },
    );
    expect(root.textContent).toContain("Error: passkey dismissed");
  });
});

// ─── Naming the requester, and gating danger ──────────────────────────────────

const infoLine = { text: "Send 1 ETH to 0xabc", severity: "info" as const };
const dangerLine = { text: "Approve UNLIMITED spending", severity: "danger" as const };

function freshRoot(): HTMLElement {
  document.body.innerHTML = "<div id='root'></div>";
  return document.getElementById("root") as HTMLElement;
}

describe("showConsent: who is asking", () => {
  it("names the requesting origin, since the Vault serves anyone who asks", () => {
    const root = freshRoot();
    void createDomView(root).showConsent([infoLine], { requestOrigin: "https://example10.com" });
    expect(root.textContent).toContain("example10.com");
  });

  it("says so when no origin can be named, rather than leaving it blank", () => {
    const root = freshRoot();
    void createDomView(root).showConsent([infoLine], {});
    expect(root.textContent).toMatch(/can't tell you|cannot tell you|unknown/i);
  });
});

describe("showConsent: danger", () => {
  it("approves an ordinary request with a single click", async () => {
    const root = freshRoot();
    const decision = createDomView(root).showConsent([infoLine], { requestOrigin: "https://example1.com" });
    const approve = [...root.querySelectorAll("button")].find((b) => /approve/i.test(b.textContent ?? ""));
    approve?.click();
    await expect(decision).resolves.toBe(true);
  });

  // WARN, NEVER BLOCK. A dangerous request stays approvable. What changes is that it cannot be
  // cleared by muscle memory in the place the ordinary button sits.
  it("requires a deliberate confirmation for a dangerous request, and still allows it", async () => {
    const root = freshRoot();
    const decision = createDomView(root).showConsent([dangerLine], { requestOrigin: "https://example10.com" });
    const approve = [...root.querySelectorAll("button")].find((b) => /approve/i.test(b.textContent ?? ""));
    expect(approve?.hasAttribute("disabled")).toBe(true);

    const ack = root.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(ack).not.toBeNull();
    ack.click();

    expect(approve?.hasAttribute("disabled")).toBe(false);
    approve?.click();
    await expect(decision).resolves.toBe(true);
  });

  it("offers no acknowledgement step for a request that is not dangerous", () => {
    const root = freshRoot();
    void createDomView(root).showConsent([infoLine], { requestOrigin: "https://example1.com" });
    expect(root.querySelector("input[type=checkbox]")).toBeNull();
  });

  it("keeps Reject reachable on a request that cannot be approved", async () => {
    const root = freshRoot();
    const decision = createDomView(root).showConsent([infoLine], { rejectOnly: true });
    expect([...root.querySelectorAll("button")].some((b) => /approve/i.test(b.textContent ?? ""))).toBe(false);
    const reject = [...root.querySelectorAll("button")].find((b) =>
      /reject|close|cancel|dismiss/i.test(b.textContent ?? ""),
    );
    reject?.click();
    await expect(decision).resolves.toBe(false);
  });

  // A dangerous request that also cannot be decoded must not offer a way through: the gate exists to
  // slow an approval down, never to create one where there was none.
  it("does not resurrect Approve when a dangerous request is also reject-only", () => {
    const root = freshRoot();
    void createDomView(root).showConsent([dangerLine], { rejectOnly: true });
    expect([...root.querySelectorAll("button")].some((b) => /approve/i.test(b.textContent ?? ""))).toBe(false);
    expect(root.querySelector("input[type=checkbox]")).toBeNull();
  });
});

// A failed attempt loops back to the consent screen. The gate must RE-ARM: a retry is another
// chance to approve something dangerous, and carrying the earlier acknowledgement forward would let
// the second approval through on one click. Verified in a browser first, then pinned here.
describe("showConsent: the gate re-arms on retry", () => {
  it("disables Approve and clears the acknowledgement on every render", () => {
    const root = freshRoot();
    const view = createDomView(root);

    void view.showConsent([dangerLine], { requestOrigin: "https://example10.com" });
    const ack1 = root.querySelector("input[type=checkbox]") as HTMLInputElement;
    ack1.click();
    expect([...root.querySelectorAll("button")].find((b) => /approve/i.test(b.textContent ?? ""))?.disabled).toBe(
      false,
    );

    // The retry render, as the ceremony's loop performs it after a failed signature.
    void view.showConsent([dangerLine], { requestOrigin: "https://example10.com", error: "passkey failed" });
    const ack2 = root.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(ack2.checked).toBe(false);
    expect([...root.querySelectorAll("button")].find((b) => /approve/i.test(b.textContent ?? ""))?.disabled).toBe(true);
  });
});

// Everything worth reading on this screen is an unbreakable token: a 42-character address, a
// 78-digit uint256, a long origin. `pre-wrap` alone breaks at whitespace and nowhere else, so those
// run straight out of a 400px popup. Caught by looking at the rendered page, not by a test.
describe("showConsent: long values stay inside the box", () => {
  const huge = {
    text: `value: ${(2n ** 256n - 1n).toString()}`,
    severity: "danger" as const,
  };

  it("lets unbreakable tokens wrap, in the request body and the origin banner", () => {
    const root = freshRoot();
    void createDomView(root).showConsent([huge], {
      requestOrigin: "https://a-very-long-subdomain-name.example-operator-domain.com",
    });
    // Every rendered line wraps, not just a single container.
    const rendered = [...root.querySelectorAll("div")].filter(
      (d) => d.textContent === huge.text && d.children.length === 0,
    );
    expect(rendered.length).toBe(1);
    expect(rendered[0].style.overflowWrap).toBe("anywhere");
    expect(rendered[0].style.maxWidth).toBe("100%");
    // Exact match: the outer box also CONTAINS this text, and it comes first in document order.
    const banner = [...root.querySelectorAll("div")].find(
      (d) => (d.textContent ?? "").startsWith("Request from") && d.children.length === 0,
    );
    expect(banner?.style.overflowWrap).toBe("anywhere");
  });

  it("keeps the container's padding inside its own width", () => {
    const root = freshRoot();
    void createDomView(root).showConsent([huge], { requestOrigin: "https://example1.com" });
    const box = root.firstElementChild as HTMLElement;
    expect(box.style.boxSizing).toBe("border-box");
  });
});

// A terminal screen with no button is a dead end: the only exit is the window's own chrome, which on
// a popup many people will not find. Found by driving a malformed authorize in a browser.
describe("failure", () => {
  it("offers a way out", () => {
    const root = freshRoot();
    createDomView(root).failure("Authorization request carried no challenge nonce");
    expect(root.textContent).toContain("carried no challenge nonce");
    const close = [...root.querySelectorAll("button")].find((b) => /close/i.test(b.textContent ?? ""));
    expect(close, "a terminal screen must still offer an action").toBeTruthy();
  });

  it("wraps a long failure message rather than overflowing", () => {
    const root = freshRoot();
    createDomView(root).failure(`x${"y".repeat(300)}`);
    const p = root.querySelector("p") as HTMLElement;
    expect(p.style.overflowWrap).toBe("anywhere");
  });
});
