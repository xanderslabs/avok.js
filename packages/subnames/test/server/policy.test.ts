import { describe, expect, test } from "vitest";
import { getAddress } from "viem";
import { createLabelPolicy, LabelNotIssuableError } from "../../src/server/index.js";

const OWNER = getAddress("0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c");

describe("createLabelPolicy", () => {
  test("rejects a reserved label (normalized)", async () => {
    const p = createLabelPolicy({ reserved: ["admin"] });
    await expect(p.assertIssuable({ owner: OWNER, label: "admin" })).rejects.toBeInstanceOf(LabelNotIssuableError);
  });

  test("rejects a denylisted label", async () => {
    const p = createLabelPolicy({ denylist: ["scam"] });
    await expect(p.assertIssuable({ owner: OWNER, label: "scam" })).rejects.toBeInstanceOf(LabelNotIssuableError);
  });

  test("rejects when canIssueVoucher returns false", async () => {
    const p = createLabelPolicy({ canIssueVoucher: () => false });
    await expect(p.assertIssuable({ owner: OWNER, label: "alice" })).rejects.toBeInstanceOf(LabelNotIssuableError);
  });

  test("passes the normalized label + owner to canIssueVoucher", async () => {
    let seen: { owner: string; label: string } | undefined;
    const p = createLabelPolicy({
      canIssueVoucher: (a) => {
        seen = a;
        return true;
      },
    });
    await p.assertIssuable({ owner: OWNER, label: "Alice" });
    expect(seen).toEqual({ owner: OWNER, label: "alice" });
  });

  test("allows an ordinary label with no policy", async () => {
    const p = createLabelPolicy({});
    await expect(p.assertIssuable({ owner: OWNER, label: "alice" })).resolves.toBeUndefined();
  });
});
