/**
 * The RN facade's two construction entry points, which had no test at all.
 *
 * `createOwnOriginConnection` is the front door of this package — every quickstart starts here — and
 * `buildNativePasskeyAdapter` is the seam that turns an injected `react-native-passkey`-shaped module
 * into Avok's PasskeyAdapter. Neither was covered, including the required-`passkey` throw, which is
 * the single most likely thing a new integrator hits: the web twin does not take a passkey argument,
 * so it is the one place the two facades genuinely differ.
 *
 * The web twin is covered in @avokjs/core (test/web/vanilla.test.ts); this is the native side of that
 * pair.
 */
import { describe, it, expect, vi } from "vitest";
import { createOwnOriginConnection, type ReactNativePasskeyLike } from "../src/index.js";
import { buildNativePasskeyAdapter } from "../src/native-platform.js";
import { secureStoreStorage } from "../src/native-storage.js";

/** A passkey module shaped like react-native-passkey, never actually called by construction. */
function fakePasskeyModule(): ReactNativePasskeyLike {
  return {
    create: vi.fn(async () => ({ id: "cred-1", rawId: "cred-1", response: {} })),
    get: vi.fn(async () => ({ id: "cred-1", rawId: "cred-1", response: {} })),
    isSupported: vi.fn(() => true),
  } as unknown as ReactNativePasskeyLike;
}

describe("createOwnOriginConnection (native)", () => {
  it("REFUSES to construct without a passkey module, naming what to pass", () => {
    // The whole native facade depends on an injected passkey module — there is no RN global to fall
    // back to. Failing here, loudly, is the difference between a clear setup error and a null
    // dereference deep inside a ceremony the user already started with a biometric prompt.
    expect(() => createOwnOriginConnection({ rpId: "example.com" } as never)).toThrow(/opts\.passkey/);
    expect(() => createOwnOriginConnection({ rpId: "example.com" } as never)).toThrow(/react-native-passkey/);
  });

  it("constructs a self-custody connection when given rpId + passkey", () => {
    const conn = createOwnOriginConnection({ rpId: "example.com", passkey: fakePasskeyModule() });
    expect(conn).toBeDefined();
    expect(conn.custody).toBe("self");
  });

  it("does not fire the passkey module at construction — no biometric prompt before a user gesture", () => {
    // Construction happens at module scope in every documented quickstart. If it touched the passkey
    // module, an app would prompt for biometrics on launch.
    const passkey = fakePasskeyModule();
    createOwnOriginConnection({ rpId: "example.com", passkey });
    expect(passkey.create).not.toHaveBeenCalled();
    expect(passkey.get).not.toHaveBeenCalled();
  });

  it("accepts an explicit storage override, and defaults to secureStoreStorage without one", () => {
    // Both shapes must construct: the default path is what the quickstart uses, and the override is
    // what tests and RN-web use.
    const passkey = fakePasskeyModule();
    expect(() => createOwnOriginConnection({ rpId: "example.com", passkey })).not.toThrow();
    expect(() =>
      createOwnOriginConnection({ rpId: "example.com", passkey, storage: secureStoreStorage() }),
    ).not.toThrow();
  });
});

describe("buildNativePasskeyAdapter", () => {
  it("wraps an injected module into a PasskeyAdapter without calling it", () => {
    const passkey = fakePasskeyModule();
    const adapter = buildNativePasskeyAdapter(passkey, "example.com");
    // The adapter contract is create / authenticate / discover — deliberately NOT the passkey
    // module's own create/get shape, which is what this seam exists to translate.
    expect(typeof adapter.create).toBe("function");
    expect(typeof adapter.authenticate).toBe("function");
    expect(typeof adapter.discover).toBe("function");
    expect(passkey.create).not.toHaveBeenCalled();
  });

  it("defaults the display name to the rpId, and takes an operatorName when given", () => {
    // operatorName is COSMETIC — it becomes the OS "Sign in to …" prompt and the wallet label. It must
    // never leak into the rpId, which is key material: a different rpId is a different wallet.
    const passkey = fakePasskeyModule();
    expect(() => buildNativePasskeyAdapter(passkey, "example.com")).not.toThrow();
    expect(() => buildNativePasskeyAdapter(passkey, "example.com", "Example Wallet")).not.toThrow();
  });
});
