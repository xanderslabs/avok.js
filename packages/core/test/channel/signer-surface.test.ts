import { describe, it, expect } from "vitest";
import { createRemoteSigner } from "../../src/channel/signer.js";

const signer = createRemoteSigner({
  channel: { open: async () => ({ kind: "sign", result: { signature: "0x" } }) } as never,
});

describe("the remote signer surface", () => {
  // GUARD. v1 is EVM-only. These two verbs are how a Solana payload reached the signing popup.
  it("exposes no Solana verbs", () => {
    expect(signer).not.toHaveProperty("signSolanaTransaction");
    expect(signer).not.toHaveProperty("signSolanaMessage");
  });

  it("still exposes every EVM verb", () => {
    for (const verb of [
      "signMessage",
      "signTypedData",
      "signSiwe",
      "signSend",
      "signSponsored",
      "signUserOp",
      "signAuthorization",
      "signTransaction",
    ]) {
      expect(typeof (signer as unknown as Record<string, unknown>)[verb]).toBe("function");
    }
  });
});
