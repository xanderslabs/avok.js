import { expect, test } from "vitest";
import * as provider from "../src/index.js";
test("package exports the three surface entry points", () => {
  expect(typeof provider.createEip1193Provider).toBe("function");
  expect(typeof provider.announceEip6963).toBe("function");
  expect(typeof provider.registerAvokSolanaWallet).toBe("function");
});
