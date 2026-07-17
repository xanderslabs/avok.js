import { describe, expect, it, vi } from "vitest";

// The demo's config validates VITE_RP_ID against the serving origin at MODULE LOAD, which throws
// under jsdom ("localhost"). Stub the module — this test is about the consent screen, not the guard.
vi.mock("../src/config.js", () => ({
  hasEvmFronted: false,
  hasSolanaFronted: false,
  config: { anchorChainNumeric: 5042002 },
}));

import { Send } from "../src/screens/Send.js";
import type { Ctx } from "../src/core/app.js";

/**
 * THE CONSENT SCREEN MUST SHOW A FEE AMOUNT.
 *
 * This demo used to hand raw calls straight to `send()` and never simulate. Its consent screen could
 * therefore only name the rail and the token — it showed the user NO fee number at all, and the file
 * header cheerfully said so. "It's just a demo" is exactly how a fee-less consent screen ships: the
 * demos are what people copy.
 *
 * Review now simulates, and Confirm sends THAT simulation, so the number on screen is also the number
 * that gets signed. These tests drive the real screen through a fake client and read the DOM.
 */

const EVM_SIM = {
  success: true,
  batch: { rail: "self-pay" },
  gasEstimate: 52_000n,
  // Self-pay: no committed `fee`, an ESTIMATED native cost instead. Arc's native gas asset is USDC
  // and is 18-dec wei (its ERC-20 USDC is 6-dec — formatting with 6 would overstate by 1e12).
  nativeFee: { amount: 4_598_675_036_592_640n, gasUnits: 85_000n, gasPrice: 54_102_059_254n },
};

function fakeCtx(): Ctx {
  const client = {
    account: () => ({ evm: { address: "0x1111111111111111111111111111111111111111" }, solana: { address: "So1" } }),
    evm: {
      feeTokens: () => [],
      simulate: vi.fn(async () => EVM_SIM),
      send: vi.fn(async () => ({ id: "0xabc", rail: "self-pay", status: "submitted", txHash: "0xabc" })),
      wait: vi.fn(async () => ({ status: "confirmed", txHash: "0xabc" })),
      resolveName: vi.fn(async () => null),
    },
    solana: { feeTokens: () => [], simulate: vi.fn(), send: vi.fn() },
  };
  return {
    client,
    config: { anchorChainNumeric: 5042002 },
    store: { get: () => ({}), set: () => {}, subscribe: () => () => {} },
    go: () => {},
    setAccount: () => {},
    refreshAccount: () => {},
  } as unknown as Ctx;
}

/** Drive the screen to the consent step the way a user does: fill the form, press Review. */
async function reviewLines(ctx: Ctx): Promise<string> {
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
  // Let the resolve + simulate promises settle.
  await vi.waitFor(() => {
    if (!/confirm transfer/i.test(root.textContent ?? "")) throw new Error("not on consent yet");
  });
  return root.textContent ?? "";
}

describe("the vanilla consent screen shows a fee", () => {
  it("simulates on Review — it does not go straight to a fee-less consent screen", async () => {
    const ctx = fakeCtx();
    await reviewLines(ctx);
    expect(ctx.client.evm.simulate).toHaveBeenCalledOnce();
  });

  it("shows the self-pay fee AMOUNT, in the native asset, not a shrug", async () => {
    const text = await reviewLines(fakeCtx());
    // 4598675036592640 wei at 18 decimals = 0.00459867503659264 — the real cost of the send.
    expect(text).toContain("0.00459867503659264");
    expect(text).toMatch(/estimated/i);
    // The old copy: a fee mode with no number attached.
    expect(text).not.toMatch(/at the current gas price/i);
  });

  it("names the recipient — the one field an attacker most wants swapped", async () => {
    const text = await reviewLines(fakeCtx());
    expect(text).toContain("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  });

  it("Confirm sends the SIMULATION, so the signed bytes are the bytes on screen", async () => {
    const ctx = fakeCtx();
    const root = Send(ctx);
    document.body.replaceChildren(root);
    await reviewLines(ctx);

    const confirm = [...document.querySelectorAll("button")].find((b) => /confirm|send/i.test(b.textContent ?? ""));
    confirm!.click();
    await vi.waitFor(() => {
      if (!(ctx.client.evm.send as ReturnType<typeof vi.fn>).mock.calls.length) throw new Error("not sent");
    });

    const arg = (ctx.client.evm.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // A raw array of calls here would mean the batch was re-resolved after the user consented — and a
    // re-resolve re-prices the fee.
    expect(Array.isArray(arg)).toBe(false);
    expect(arg).toBe(EVM_SIM);
  });
});
