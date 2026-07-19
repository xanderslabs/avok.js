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
      "simulateSolanaMessage",
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

  // Low-level internals stay off the /solana subpath: the per-signature/rent constants, the ATA-exists
  // probe, the base simulateSolana variant, the priority-fee selection mechanics, the off-chain version
  // discriminant, and the decode surface (which is its own /decode subpath). A re-add should trip this.
  it("does NOT re-export the low-level internals or the decode surface", () => {
    for (const name of [
      "LAMPORTS_PER_SIGNATURE",
      "ATA_PROGRAM_ADDRESS",
      "ataExists",
      "simulateSolana",
      "selectPriorityFee",
      "DEFAULT_PRIORITY_FEE_PERCENTILE",
      "OFFCHAIN_MESSAGE_VERSION",
      "decodeCompiledMessage",
      "classifySplTransfer",
      "TOKEN_2022_PROGRAM_ADDRESS",
    ]) {
      expect(api, `internal leaked to the barrel: ${name}`).not.toHaveProperty(name);
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
