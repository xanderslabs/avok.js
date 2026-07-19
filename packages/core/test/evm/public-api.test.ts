import { expect, test } from "vitest";
import * as api from "../../src/evm/index.js";

test("public surface exposes the pipeline verbs and adapters", () => {
  for (const name of [
    "simulateResolved",
    "getReceiptStatus",
    "createViemRpcClient",
    "createViemVaultReader",
    "estimateNativeFee",
    "railFromContext",
    "getChainProfile",
    // 4337 sponsored rail (replaces the deleted bespoke relay client)
    "createPaymaster7677",
    "createBundler",
    "buildUserOp",
    "getAvokUserOpHash",
  ]) {
    expect(api[name as keyof typeof api], `missing export: ${name}`).toBeTypeOf("function");
  }
});

test("does NOT re-export gas-model internals or the unused viem smart-account wrapper", () => {
  // The raw self-pay gas constants + gas/price mechanics are internal (reached via pricing/resolve),
  // and toAvokSmartAccount was a dead viem integration nothing wired (the sponsored rail signs the
  // hash directly via buildUserOp + getAvokUserOpHash). A re-add should trip this, not slip in.
  for (const internal of [
    "BASE_TX_GAS",
    "AUTH_7702_GAS",
    "SELF_PAY_FEE_MUL",
    "SELF_PAY_TIP_MUL",
    "selfPayEffectiveGasPrice",
    "selfPayGasEstimate",
    "decodeCalls",
    "toAvokSmartAccount",
    // resolveBatch was dead (only leanResolve is used, in client/); deleted.
    "resolveBatch",
  ]) {
    expect(api).not.toHaveProperty(internal);
  }
});

test("public surface exposes CHAIN_PROFILES and send-builders", () => {
  expect(Array.isArray(api.CHAIN_PROFILES) || typeof api.CHAIN_PROFILES === "object").toBe(true);
  expect(typeof api.buildSelfPayCalldata).toBe("function");
});
