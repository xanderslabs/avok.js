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

  it("defaults the display name to the rpId, and takes an operatorName when given", async () => {
    // operatorName is COSMETIC — it becomes the OS "Sign in to …" prompt (rp.name) and the wallet
    // label. It must NEVER leak into rp.id, which is key material: a different rpId is a different
    // wallet, so a cosmetic rename that reached it would silently strand every existing user.
    //
    // Asserting on what the passkey module actually RECEIVES. An earlier version of this test only
    // checked that construction did not throw, which proved nothing about the defaulting it named.
    // The ceremony is driven to the point where the module is called and no further: this fake
    // returns no PRF, so the adapter correctly falls back to a get() and ultimately raises
    // NoPrfError. That is the right behaviour and not what is under test here, so the rejection is
    // swallowed — rp is already on the wire by then.
    const handle = new Uint8Array([1, 2, 3]);
    const drive = async (module: ReactNativePasskeyLike, operatorName?: string) => {
      await buildNativePasskeyAdapter(module, "example.com", operatorName)
        .create("label", handle)
        .catch(() => {});
    };

    const defaulted = fakePasskeyModule();
    await drive(defaulted);
    expect(defaulted.create).toHaveBeenCalledWith(
      expect.objectContaining({ rp: { name: "example.com", id: "example.com" } }),
    );

    const named = fakePasskeyModule();
    await drive(named, "Example Wallet");
    // rp.name takes the operator's name; rp.id stays the domain, untouched.
    expect(named.create).toHaveBeenCalledWith(
      expect.objectContaining({ rp: { name: "Example Wallet", id: "example.com" } }),
    );
  });
});
