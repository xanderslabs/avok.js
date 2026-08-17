import { expect, test } from "vitest";
import * as provider from "../../src/provider/index.js";
test("package exports the two surface entry points", () => {
  expect(typeof provider.createEip1193Provider).toBe("function");
  expect(typeof provider.announceEip6963).toBe("function");
});
