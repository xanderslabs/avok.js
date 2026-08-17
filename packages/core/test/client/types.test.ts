import { describe, it, expect } from "vitest";
import type { Connection } from "../../src/types.js";

describe("types", () => {
  it("Connection is the one custody posture (D3: popup-for-all): Signer verbs + continue/logout/account/status", () => {
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
    ];
    expect(keys.length).toBe(9);
  });

  it("wallet lifecycle verbs (create/export/addPasskey) are not part of Connection — they live on the vault", () => {
    // @ts-expect-error create is a vault-side verb — absent from Connection
    const _create: keyof Connection = "create";
    // @ts-expect-error export is a vault-side verb — absent from Connection
    const _export: keyof Connection = "export";
    void _create;
    void _export;
  });
});
