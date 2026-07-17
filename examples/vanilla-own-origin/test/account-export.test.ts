/**
 * Screen-level guard for the Export ceremony (the F1 key-loss shape).
 *
 * The F1 bug was NOT a missing Export button — it was the reveal step rendering
 * only the EVM key, so the Solana key the export verb returns never reached the DOM.
 * A user who exported, wiped, and restored lost their Solana funds. This mounts
 * the real Account screen, drives reveal → confirm with the export verbs stubbed
 * to resolve two recognisable strings, and asserts BOTH key VALUES land on screen.
 * It does not assert the verbs were called, nor that a flag flipped — only what a
 * user could actually copy off the screen.
 *
 * #3 split `export()` into exportEvmKey() (the ROOT) + exportSolanaKey() (the LEAF); the guard is
 * unchanged in substance — both values must still reach the DOM.
 *
 * jsdom env is set globally in vitest.config. No @testing-library: it is not a
 * declared/resolvable dep of this example under strict pnpm, and the assertion we
 * need ("both key strings are in the DOM") is a plain textContent check.
 */
import { describe, expect, it, vi } from "vitest";
import { Account } from "../src/screens/Account.js";
import type { Ctx } from "../src/core/app.js";

const account = {
  evm: { address: "0x1111111111111111111111111111111111111111" },
  solana: { address: "AvokSoLDemoAddress11111111111111111111111111" },
};

function makeCtx(exported: { evm: string; solana: string }): Ctx {
  return {
    client: {
      account: () => account,
      exportEvmKey: vi.fn().mockResolvedValue(exported.evm),
      exportSolanaKey: vi.fn().mockResolvedValue(exported.solana),
      // Account renders the CHAIN-VERIFIED access-slot count ("ways into this wallet"), never
      // passkeyCount(). accessSlotCount() is keyless, so the screen calls it on mount.
      accessSlotCount: vi.fn().mockResolvedValue(1),

    },
    config: { anchorChainNumeric: 10 },
    go: vi.fn(),
  } as unknown as Ctx;
}

function clickButton(root: HTMLElement, label: string): void {
  const btn = [...root.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  if (!btn) throw new Error(`button "${label}" not found in mounted screen`);
  btn.click();
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Account Export reveals BOTH raw keys the export verbs return", () => {
  it("renders the EVM key AND the Solana key after the reveal ceremony", async () => {
    const keys = {
      evm: "0xEXPORTEDevmKEYdeadbeef00000000000000000000000000000000000000cafe",
      solana: "EXPORTEDsolanaKEYbase58AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAzzz9",
    };
    const root = Account(makeCtx(keys));

    // idle → confirm → handleExport (danger-gated two-step reveal).
    clickButton(root, "Export wallet");
    clickButton(root, "Confirm export");
    await flush();

    // The literal strings a user must copy have to be on screen. If the reveal
    // step discarded either key (the F1 shape), one of these is absent and fails.
    expect(root.textContent).toContain(keys.evm);
    expect(root.textContent).toContain(keys.solana);
  });
});
