import { describe, it, expect } from "vitest";
import type { Connection, SelfCustodyConnection, ClientConfig } from "../../src/types.js";

describe("types", () => {
  it("Connection is the use-only surface: Signer verbs + continue/logout/account/status/custody", () => {
    const keys: (keyof Connection)[] = [
      "signMessage",
      "signTypedData",
      "signSiwe",
      "signAuthorization",
      "signTransaction",
      "continue",
      "logout",
      "account",
      "status",
      "custody",
    ];
    expect(keys.length).toBe(10);
  });

  it("custody-management verbs are NOT part of the use-only Connection surface", () => {
    // @ts-expect-error create is a custody verb — absent from the use-only Connection surface
    const _create: keyof Connection = "create";
    // @ts-expect-error export is a custody verb — absent from the use-only Connection surface
    const _export: keyof Connection = "export";
    void _create;
    void _export;
  });

  it("SelfCustodyConnection carries the custody-management verbs (import + canImport gone; addPasskey writes on chain)", () => {
    const keys: (keyof SelfCustodyConnection)[] = ["create", "export", "addPasskey", "canExport", "passkeyCount"];
    expect(keys.length).toBe(5);
  });

  // Solana sponsoring is bring-your-own Kora (sub-project #5). Kora is BOTH the fee payer and the
  // submitter, so this ONE endpoint is the Solana analogue of `paymasterUrl` + `bundlerUrl` together.
  it("ClientConfig carries koraUrl for Solana sponsoring", () => {
    const cfg: Pick<ClientConfig, "koraUrl"> = { koraUrl: "https://kora.test" };
    expect(cfg.koraUrl).toBe("https://kora.test");
  });
});
