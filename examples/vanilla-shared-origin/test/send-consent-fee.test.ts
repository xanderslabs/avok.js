import { describe, expect, it, vi } from "vitest";

// The demo's config validates VITE_RP_ID against the serving origin at MODULE LOAD, which throws
// under jsdom ("localhost"). Stub the module — this test is about the Send screen, not the guard.
vi.mock("../src/config.js", () => ({
  hasEvmSponsored: false,
  hasSolanaSponsored: false,
  config: {},
}));

import { Send } from "../src/screens/Send.js";
import type { Ctx } from "../src/core/app.js";

/**
 * SHARED-ORIGIN IS A DAPP — the WALLET owns consent + the fee.
 *
 * Unlike the own-origin demo (which IS the wallet and renders its own fee-bearing consent), a
 * shared-origin app does not hold the key and cannot render the authoritative fee. So the EVM rail
 * drives the standard EIP-5792 provider: Confirm calls `wallet_sendCalls` (the wallet's sign popup
 * shows the fee + calls and enforces sign-what-you-saw), then `wallet_getCallsStatus` tracks it. These
 * tests drive the real screen through a fake client + provider and read the DOM / the provider calls.
 */

function fakeCtx() {
  const request = vi.fn(async ({ method }: { method: string; params?: unknown[] }) => {
    if (method === "wallet_sendCalls") return { id: "0xbundle" };
    if (method === "wallet_getCallsStatus")
      return { status: 200, receipts: [{ status: "0x1", transactionHash: "0xhash" }] };
    return null;
  });
  const client = {
    account: () => ({ evm: { address: "0x1111111111111111111111111111111111111111" }, solana: { address: "So1" } }),
    evm: { feeTokens: () => [], resolveName: vi.fn(async () => null) },
    solana: { feeTokens: () => [] },
    getEip1193Provider: () => ({ request }),
  };
  const ctx = {
    client,
    config: {},
    store: { get: () => ({}), set: () => {}, subscribe: () => () => {} },
    go: () => {},
    setAccount: () => {},
    refreshAccount: () => {},
  } as unknown as Ctx;
  return { ctx, request };
}

/** Drive the screen to the consent step the way a user does: fill the form, press Review. */
async function reviewLines(ctx: Ctx): Promise<{ root: HTMLElement; text: string }> {
  const root = Send(ctx);
  document.body.replaceChildren(root);

  const to = root.querySelector<HTMLInputElement>('input[placeholder*="0x"], input')!;
  to.value = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  to.dispatchEvent(new Event("input", { bubbles: true }));

  const inputs = [...root.querySelectorAll<HTMLInputElement>("input")];
  const amount = inputs[inputs.length - 1]!;
  amount.value = "0.1";
  amount.dispatchEvent(new Event("input", { bubbles: true }));

  const review = [...root.querySelectorAll("button")].find((b) => /review/i.test(b.textContent ?? ""));
  review!.click();
  await vi.waitFor(() => {
    if (!/confirm transfer/i.test(document.body.textContent ?? "")) throw new Error("not on consent yet");
  });
  return { root, text: document.body.textContent ?? "" };
}

describe("shared-origin: EVM Send drives the standard provider (the wallet owns consent)", () => {
  it("reaches consent without submitting anything yet — Review does not send", async () => {
    const { ctx, request } = fakeCtx();
    await reviewLines(ctx);
    // The dapp does NOT simulate or send on Review; nothing hits the provider until Confirm.
    expect(request).not.toHaveBeenCalled();
  });

  it("defers the fee to the wallet — it does not invent a number the dapp cannot verify", async () => {
    const { ctx } = fakeCtx();
    const { text } = await reviewLines(ctx);
    expect(text.toLowerCase()).toContain("shown in your wallet");
  });

  it("names the recipient — the one field an attacker most wants swapped", async () => {
    const { ctx } = fakeCtx();
    const { text } = await reviewLines(ctx);
    expect(text).toContain("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  });

  it("Confirm submits via wallet_sendCalls and tracks it with wallet_getCallsStatus", async () => {
    const { ctx, request } = fakeCtx();
    await reviewLines(ctx);

    const confirm = [...document.querySelectorAll("button")].find((b) => /confirm|send/i.test(b.textContent ?? ""));
    confirm!.click();

    await vi.waitFor(() => {
      if (!request.mock.calls.some((c) => (c[0] as { method: string }).method === "wallet_sendCalls"))
        throw new Error("not sent");
    });
    const sent = request.mock.calls.find((c) => (c[0] as { method: string }).method === "wallet_sendCalls")!;
    const req = (sent[0] as { params: [{ calls: unknown[]; from: string }] }).params[0];
    expect(req.calls.length).toBeGreaterThan(0); // the built EVM calls went to the wallet
    expect(req.from.toLowerCase()).toBe("0x1111111111111111111111111111111111111111");

    // It TRACKS the bundle — it never rounds a still-pending send up to success.
    await vi.waitFor(() => {
      if (!request.mock.calls.some((c) => (c[0] as { method: string }).method === "wallet_getCallsStatus"))
        throw new Error("not tracked");
    });
  });
});
