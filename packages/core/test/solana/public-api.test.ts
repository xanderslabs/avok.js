import { describe, expect, it } from "vitest";
import * as api from "../../src/solana/index.js";

describe("public API exports", () => {
  it("exports all expected names", () => {
    const expected = [
      "railFromContext",
      "toKitSigner",
      "buildSplTransfer",
      "estimateSolanaNativeFee",
      "buildSolanaMessage",
      "simulateSolana",
      "sendSolana",
      "createKora",
      "buildKoraFeePayment",
      "KoraRejectedError",
      "getReceiptStatus",
      "createSolanaRpcClient",
      "encodeOffchainMessage",
    ];
    for (const name of expected) {
      expect(api, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  // The bespoke Solana relay is GONE — not deprecated, not re-exported under an alias. Kora replaces it
  // wholesale (sub-project #5); leaving a shim would keep a second, untested sponsoring dialect alive.
  //
  // `priceSolanaFee` went with it: KORA prices the sponsored rail now, and a second pricer derived here
  // could only ever disagree with the one that actually decides — which is what `fee_too_low` was.
  it("no longer exports the bespoke relay or a rival fee pricer", () => {
    for (const name of ["relay", "getStatus", "SolanaRelayerRejectedError", "priceSolanaFee"]) {
      expect(api, `stale export: ${name}`).not.toHaveProperty(name);
    }
  });
});
