import { describe, it, expect } from "vitest";
import { rdnsFromOrigin, resolveAnnouncedIdentity } from "../../src/provider/wallet-info.js";

describe("rdnsFromOrigin", () => {
  it("reverses a dotted hostname", () => {
    expect(rdnsFromOrigin("wallet.example.com")).toBe("com.example.wallet");
  });

  it("accepts a full origin and ignores scheme, port, and path", () => {
    expect(rdnsFromOrigin("https://wallet.example.com:3000/auth")).toBe("com.example.wallet");
  });

  it("reverses a bare registrable domain", () => {
    expect(rdnsFromOrigin("example.com")).toBe("com.example");
  });

  it("leaves single-label hosts unchanged (localhost has no meaningful reversal)", () => {
    expect(rdnsFromOrigin("localhost")).toBe("localhost");
    expect(rdnsFromOrigin("https://localhost:3000")).toBe("localhost");
  });

  it("leaves an IPv4 literal unchanged rather than reversing its octets", () => {
    expect(rdnsFromOrigin("127.0.0.1")).toBe("127.0.0.1");
    expect(rdnsFromOrigin("http://127.0.0.1:8080")).toBe("127.0.0.1");
  });
});

describe("resolveAnnouncedIdentity", () => {
  it("keeps operator-supplied name and rdns verbatim", () => {
    expect(
      resolveAnnouncedIdentity({ name: "Example Wallet", rdns: "com.example.wallet" }, "https://anything.test"),
    ).toEqual({ name: "Example Wallet", rdns: "com.example.wallet" });
  });

  it("derives a missing name from the origin hostname", () => {
    expect(resolveAnnouncedIdentity({ rdns: "com.example.wallet" }, "https://wallet.example.com").name).toBe(
      "wallet.example.com",
    );
  });

  it("derives a missing rdns from the origin", () => {
    expect(resolveAnnouncedIdentity({ name: "Example Wallet" }, "https://wallet.example.com").rdns).toBe(
      "com.example.wallet",
    );
  });

  it("derives both when the wallet is omitted entirely", () => {
    expect(resolveAnnouncedIdentity(undefined, "https://wallet.example.com")).toEqual({
      name: "wallet.example.com",
      rdns: "com.example.wallet",
    });
  });

  it("never yields an Avok brand from a derived identity", () => {
    const id = resolveAnnouncedIdentity(undefined, "https://wallet.example.com");
    expect(JSON.stringify(id).toLowerCase()).not.toContain("avok");
  });
});
