import { expect, test } from "vitest";
import * as api from "../../src/evm/index.js";

test("public surface exposes the pipeline verbs and adapters", () => {
  for (const name of [
    "resolveBatch", "simulateResolved", "getReceiptStatus",
    "createViemRpcClient", "createViemVaultReader",
    "estimateNativeFee",
    "railFromContext", "getChainProfile",
    // 4337 sponsored rail (replaces the deleted bespoke relay client)
    "createPaymaster7677", "createBundler", "buildUserOp", "getAvokUserOpHash", "toAvokSmartAccount",
  ]) {
    expect(api[name as keyof typeof api], `missing export: ${name}`).toBeTypeOf("function");
  }
});

test("public surface exposes CHAIN_PROFILES and send-builders", () => {
  expect(Array.isArray(api.CHAIN_PROFILES) || typeof api.CHAIN_PROFILES === "object").toBe(true);
  expect(typeof api.buildSelfPayCalldata).toBe("function");
});
