// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mountRecoverView } from "../../../src/auth-popup/recover/view-dom.js";
import { createRecoverCeremony } from "../../../src/auth-popup/recover/ceremony.js";
import type { RecoveryFlow } from "../../../src/vault/recover/flow.js";
import type { Address, Hex } from "viem";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const GUARDIAN_A = "0x2222222222222222222222222222222222222222" as Address;
const PROMOTE_KEY = "0x4444444444444444444444444444444444444444" as Address;

function flowWithOneGuardian(overrides: Partial<RecoveryFlow> = {}): RecoveryFlow {
  return {
    enterWallet: vi.fn(async () => ({ wallet: WALLET })),
    readGuardianState: vi.fn(async () => ({
      config: { guardians: [GUARDIAN_A], threshold: 1, recoveryDelaySeconds: 86400, guardianOpDelaySeconds: 43200 },
      pending: null,
    })),
    approveAsConnectedGuardian: vi.fn(async () => ({
      guardian: GUARDIAN_A,
      promoteKey: PROMOTE_KEY,
      nonce: 0n,
      signature: "0xsig" as Hex,
    })),
    approveWithImportedKey: vi.fn(async () => ({
      guardian: GUARDIAN_A,
      promoteKey: PROMOTE_KEY,
      nonce: 0n,
      signature: "0xsig2" as Hex,
    })),
    vetoView: vi.fn(async () => ({ pending: null, canVeto: false })),
    ...overrides,
  };
}

function setup(flowOverrides: Partial<RecoveryFlow> = {}) {
  const root = document.createElement("div");
  const flow = flowWithOneGuardian(flowOverrides);
  const ceremony = createRecoverCeremony({
    flow,
    chainId: 10,
    mintPromoteKey: vi.fn(async () => ({ address: PROMOTE_KEY })),
    connectGuardianWallet: vi.fn(async () => ({
      address: GUARDIAN_A,
      signTypedData: vi.fn(async () => "0xconnsig" as Hex),
    })),
  });
  mountRecoverView(root, ceremony);
  return { root, flow, ceremony };
}

describe("mountRecoverView", () => {
  it("renders an address/ENS input and a submit control on the enter step", () => {
    const { root } = setup();
    expect(root.querySelector("input")).not.toBeNull();
    expect([...root.querySelectorAll("button")].some((b) => /recover/i.test(b.textContent ?? ""))).toBe(true);
  });

  it("submitting the wallet renders the guardian roster, then Approve reveals both approval branches", async () => {
    const { root } = setup();
    const input = root.querySelector("input") as HTMLInputElement;
    input.value = WALLET;
    const submit = [...root.querySelectorAll("button")].find((b) => /recover/i.test(b.textContent ?? ""))!;
    submit.click();
    // enterWallet's promise chain needs a tick to settle before the view re-renders.
    await new Promise((r) => setTimeout(r, 0));
    expect(root.textContent).toContain(GUARDIAN_A);
    const approve = [...root.querySelectorAll("button")].find((b) => /approve/i.test(b.textContent ?? ""))!;
    approve.click();
    await new Promise((r) => setTimeout(r, 0));
    expect([...root.querySelectorAll("button")].some((b) => /connect/i.test(b.textContent ?? ""))).toBe(true);
    expect(root.querySelector('input[type="password"]')).not.toBeNull();
  });

  it("no guardians configured: the Approve button leads to the ceremony's own error message, not a crash", async () => {
    const { root } = setup({
      readGuardianState: vi.fn(async () => ({
        config: { guardians: [], threshold: 1, recoveryDelaySeconds: 86400, guardianOpDelaySeconds: 43200 },
        pending: null,
      })),
    });
    const input = root.querySelector("input") as HTMLInputElement;
    input.value = WALLET;
    const submit = [...root.querySelectorAll("button")].find((b) => /recover/i.test(b.textContent ?? ""))!;
    submit.click();
    await new Promise((r) => setTimeout(r, 0));
    // beginApproval is a DELIBERATE user gesture (it triggers a passkey ceremony) — the view must
    // never call it automatically just because guardian-state rendered.
    const approve = [...root.querySelectorAll("button")].find((b) => /approve/i.test(b.textContent ?? ""))!;
    approve.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.textContent).toMatch(/no guardians configured/i);
  });

  it("a pending recovery's readyAt and approval count are shown", async () => {
    const { root } = setup({
      readGuardianState: vi.fn(async () => ({
        config: { guardians: [GUARDIAN_A], threshold: 2, recoveryDelaySeconds: 86400, guardianOpDelaySeconds: 43200 },
        pending: { promoteKey: PROMOTE_KEY, nonce: 3n, approvals: 1, readyAt: 12345 },
      })),
    });
    const input = root.querySelector("input") as HTMLInputElement;
    input.value = WALLET;
    const submit = [...root.querySelectorAll("button")].find((b) => /recover/i.test(b.textContent ?? ""))!;
    submit.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.textContent).toContain("1");
    expect(root.textContent).toContain("2");
  });

  it("submitting the imported-key form produces and displays the approval", async () => {
    const { root } = setup();
    const input = root.querySelector("input") as HTMLInputElement;
    input.value = WALLET;
    const submit = [...root.querySelectorAll("button")].find((b) => /recover/i.test(b.textContent ?? ""))!;
    submit.click();
    await new Promise((r) => setTimeout(r, 0));
    const approve = [...root.querySelectorAll("button")].find((b) => /approve/i.test(b.textContent ?? ""))!;
    approve.click();
    await new Promise((r) => setTimeout(r, 0));

    const keyInput = root.querySelector('input[type="password"]') as HTMLInputElement;
    keyInput.value = "0xdeadbeef";
    const importBtn = [...root.querySelectorAll("button")].find((b) => /import/i.test(b.textContent ?? ""))!;
    importBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(root.textContent).toContain("0xsig2");
    // The raw key string must not linger in the DOM after submission.
    expect(keyInput.value).toBe("");
  });
});
