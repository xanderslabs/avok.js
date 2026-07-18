import { describe, expect, it } from "vitest";
import { getAddress, maxUint256, parseUnits } from "viem";
import { formatConsentDisplay } from "../src/sign/consent-display.js";
import type { ConsentLine } from "../src/sign/consent.js";

const ADDR = getAddress("0x9999999999999999999999999999999999999999");
const TOKEN = getAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85");

function erc20(kind: "erc20-transfer" | "erc20-approve", baseUnits: string, amount: string): ConsentLine {
  return { to: TOKEN, valueWei: "0", kind, raw: "0x", token: { symbol: "USDC", decimals: 6, amount, baseUnits, counterparty: ADDR } };
}

describe("formatConsentDisplay — EVM value ops", () => {
  it("renders a REGISTERED erc20 transfer as a human amount, with the full address", () => {
    const lines = formatConsentDisplay({ op: "signTypedData", view: { chainId: 10, calls: [erc20("erc20-transfer", "5000000", "5")] } });
    expect(lines[0]).toBe("Chain Optimism (10)");
    expect(lines[1]).toBe(`Send 5 USDC to ${ADDR}`);
    expect(lines[1]).toContain(ADDR); // untruncated — the recipient is the security-critical field
    // No "(5000000 base units)". For a REGISTERED token that parenthetical is a second rendering of
    // the same trusted number: `decodeCall` takes symbol AND decimals from the registry, never from
    // the token contract, so `amount` cannot be spoofed away from `baseUnits`. It was noise, and noise
    // on a consent screen is not free — it is what teaches people to stop reading consent screens.
    expect(lines[1]).not.toContain("base units");
  });

  it("an UNREGISTERED token still shows base units + address + a caution marker — never hidden", () => {
    // This is the case base units actually defend: no registry profile, so there is no trustworthy
    // symbol or decimals to render, and the raw number is all anyone can honestly be shown.
    const unknown: ConsentLine = {
      to: TOKEN, valueWei: "0", kind: "erc20-transfer", raw: "0x",
      token: { baseUnits: "1000000000000", counterparty: ADDR },
    };
    const lines = formatConsentDisplay({ op: "signTypedData", view: { chainId: 10, calls: [unknown] } });
    expect(lines[1]).toContain("1000000000000 base units");
    expect(lines[1]).toContain("unknown token");
    expect(lines[1]).toContain("⚠");
  });

  it("flags an unlimited approval with a caution marker; a normal approve does not", () => {
    const unlimited = formatConsentDisplay({ op: "signTypedData", view: { chainId: 10, calls: [erc20("erc20-approve", maxUint256.toString(), "…")] } });
    expect(unlimited[1]).toContain("⚠");
    expect(unlimited[1]).toContain("UNLIMITED");
    const at255 = formatConsentDisplay({ op: "signTypedData", view: { chainId: 10, calls: [erc20("erc20-approve", (2n ** 255n).toString(), "…")] } });
    expect(at255[1]).toContain("UNLIMITED");
    const normal = formatConsentDisplay({ op: "signTypedData", view: { chainId: 10, calls: [erc20("erc20-approve", parseUnits("100", 6).toString(), "100")] } });
    expect(normal[1]).not.toContain("⚠");
    expect(normal[1]).toBe(`Approve ${ADDR} to spend 100 USDC`);
  });

  it("never hides a raw/unrecognized call — full calldata shown with a marker", () => {
    const raw: ConsentLine = { to: ADDR, valueWei: "0", kind: "raw", raw: "0xdeadbeef" };
    const lines = formatConsentDisplay({ op: "signTransaction", chainId: 1, calls: [raw] });
    expect(lines[1]).toBe(`⚠ Unrecognized call to ${ADDR} — value 0 wei, data 0xdeadbeef`);
  });

  it("renders native transfers with ether + wei and the chain's native symbol", () => {
    const native: ConsentLine = { to: ADDR, valueWei: "1000000000000000000", kind: "native", raw: "0x" };
    expect(formatConsentDisplay({ op: "signTransaction", chainId: 56, calls: [native] })[1])
      .toBe(`Send 1 BNB to ${ADDR}`);
  });

  it("renders each call of a batch and the fee line last", () => {
    const view = { chainId: 10, calls: [erc20("erc20-transfer", "5000000", "5"), erc20("erc20-transfer", "1000000", "1")], fee: erc20("erc20-transfer", "20000", "0.02") };
    const lines = formatConsentDisplay({ op: "signTypedData", view });
    expect(lines).toHaveLength(4); // chain + 2 calls + fee
    expect(lines[3]).toBe("Network fee: 0.02 USDC (repaid to the paymaster)");
  });

  it("labels an unknown chain by id", () => {
    const lines = formatConsentDisplay({ op: "signTransaction", chainId: 777, calls: [] });
    expect(lines[0]).toBe("Chain chain 777");
  });
});

describe("formatConsentDisplay — auth / siwe / message", () => {
  it("flags a 7702 authorization", () => {
    const impl = getAddress("0x1111111111111111111111111111111111111111");
    expect(formatConsentDisplay({ op: "signAuthorization", chainId: 8453, implementation: impl }))
      .toEqual([`⚠ Authorize account upgrade to ${impl} on Base (8453)`]);
  });

  it("renders SIWE fields in order, skipping absent ones, resources each on a line", () => {
    const lines = formatConsentDisplay({ op: "signSiwe", fields: { domain: "example.com", uri: "https://example.com", chainId: "1", nonce: "abc", resources: "https://a\nhttps://b" } });
    expect(lines).toEqual([
      "Domain: example.com", "URI: https://example.com", "Chain: 1", "Nonce: abc",
      "Resources:", "https://a", "https://b",
    ]);
  });

  it("renders a plain message", () => {
    expect(formatConsentDisplay({ op: "signMessage", message: "approve login" }))
      .toEqual(["Sign message:", "approve login"]);
  });
});

describe("formatConsentDisplay — Solana parity (byte-identical to the old page JS)", () => {
  const base = { cluster: undefined, feePayer: "FeePayer111" };
  it("enriched spl-transfer", () => {
    const lines = formatConsentDisplay({ op: "signSolanaTransaction", view: { ...base, instructions: [
      { programId: "P", kind: "spl-transfer", token: { mint: "M", amount: "1500000", destination: "D", symbol: "USDC", decimals: 6, amountDisplay: "1.5" } },
    ] } });
    expect(lines).toEqual(["Solana transaction", "Fee payer: FeePayer111", "Token transfer: 1.5 USDC → D"]);
  });
  it("unenriched spl-transfer with no mint → (mint unavailable)", () => {
    const lines = formatConsentDisplay({ op: "signSolanaTransaction", view: { ...base, instructions: [
      { programId: "P", kind: "spl-transfer", token: { mint: "", amount: "42", destination: "D" } },
    ] } });
    expect(lines[2]).toBe("Token transfer: 42 of (mint unavailable) → D");
  });
  it("create-ata, compute-budget, native SOL, amount-unavailable, and raw instruction labels", () => {
    const lines = formatConsentDisplay({ op: "signSolanaTransaction", view: { ...base, instructions: [
      { programId: "A", kind: "spl-create-ata" },
      { programId: "C", kind: "compute-budget" },
      { programId: "S", kind: "system-transfer", native: { lamports: "5000", destination: "D" } },
      { programId: "S", kind: "system-transfer" },
      { programId: "X", kind: "raw", raw: "AA==" },
    ] } });
    expect(lines.slice(2)).toEqual([
      "Create associated token account (required to receive this token)",
      // Lamports are a machine number — 100000000 lamports means nothing to the person approving it.
      "Send 0.000005 SOL to D",
      "SOL transfer (amount unavailable)",
      "⚠ Unrecognized instruction (X)",
      // The compute-budget instructions are protocol plumbing. There are always TWO of them (limit and
      // price) and they used to render as two identical lines of noise, above the transfer they
      // budget for. One line, last.
      "Compute budget (network fee settings)",
    ]);
  });
  it("solana message", () => {
    expect(formatConsentDisplay({ op: "signSolanaMessage", message: "hi" })).toEqual(["Sign message:", "hi"]);
  });
});

/**
 * THE COMPOSITE MUST NOT HIDE THE DELEGATION.
 *
 * A composite `signSend` on an undelegated wallet is TWO approvals in one: the transaction, and the
 * EIP-7702 upgrade that points the account at an implementation contract. Collapsing the gesture must
 * never collapse the DISCLOSURE — if the delegation vanished from the screen, the user would be
 * upgrading their account without being told, which is strictly worse than the extra prompt we removed.
 */
describe("composite consent discloses the delegation", () => {
  const IMPL = "0x3333333333333333333333333333333333333333" as const;

  it("signSend shows the account upgrade when it carries an authorization", () => {
    const lines = formatConsentDisplay({
      op: "signSend",
      chainId: 10,
      calls: [],
      delegation: IMPL,
    } as never);
    expect(lines.join("\n")).toMatch(/authorize account upgrade/i);
    expect(lines.join("\n")).toContain(IMPL);
  });

  it("signSend on an ALREADY-delegated wallet shows no upgrade line (there is none)", () => {
    const lines = formatConsentDisplay({ op: "signSend", chainId: 10, calls: [] } as never);
    expect(lines.join("\n")).not.toMatch(/authorize account upgrade/i);
  });
});

/**
 * SELF-PAY STILL DISCLOSES A COST — but only the one the SIGNATURE commits to.
 *
 * Self-pay commits no fee call, so this screen has no exact amount to show, and it used to show
 * nothing at all. It cannot show the app's estimate either: the origin is stateless, has no RPC, and
 * could not check such a number — and a consent screen that renders an unverifiable figure handed to
 * it by the very app it exists to constrain is a consent screen in name only.
 *
 * What the signed bytes DO commit to is `gas × maxFeePerGas`: the most this transaction can cost.
 * That is derivable, unforgeable, and therefore the only fee fact this screen may state.
 */
describe("self-pay fee ceiling", () => {
  it("states the maximum the signature authorizes, in the chain's native gas asset", () => {
    const lines = formatConsentDisplay({
      op: "signSend",
      chainId: 5042002, // Arc — native gas asset is USDC
      calls: [],
      maxFeeWei: 4_000_000_000_000_000n, // 0.004 native
    } as never);
    const text = lines.join("\n");
    expect(text).toContain("0.004");
    expect(text).toContain("USDC");
    expect(text).toMatch(/at most/i);
    // It is a CEILING, not a quote — say so, or the user reads it as the price.
    expect(text).toMatch(/only what the transaction actually uses/i);
  });

  it("shows the committed fee INSTEAD of a ceiling when one is sponsored (never both)", () => {
    const fee: ConsentLine = {
      to: TOKEN, valueWei: "0", kind: "erc20-transfer", raw: "0x",
      token: { symbol: "USDC", decimals: 6, amount: "0.004104", baseUnits: "4104", counterparty: ADDR },
    };
    const lines = formatConsentDisplay({ op: "signSend", chainId: 5042002, calls: [], fee } as never);
    const text = lines.join("\n");
    expect(text).toContain("0.004104 USDC");
    expect(text).not.toMatch(/at most/i); // a sponsored fee is exact and signed — no ceiling language
  });
});
