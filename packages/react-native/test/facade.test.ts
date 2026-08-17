/**
 * `buildNativePasskeyAdapter` is the seam that turns an injected `react-native-passkey`-shaped module
 * into Avok's PasskeyAdapter — used by every native passkey ceremony (createWallet,
 * createDeviceEnrollmentRequest, login).
 */
import { describe, it, expect, vi } from "vitest";
import type { ReactNativePasskeyLike } from "../src/index.js";
import { buildNativePasskeyAdapter } from "../src/native-platform.js";

/** A passkey module shaped like react-native-passkey, never actually called by construction. */
function fakePasskeyModule(): ReactNativePasskeyLike {
  return {
    create: vi.fn(async () => ({ id: "cred-1", rawId: "cred-1", response: {} })),
    get: vi.fn(async () => ({ id: "cred-1", rawId: "cred-1", response: {} })),
    isSupported: vi.fn(() => true),
  } as unknown as ReactNativePasskeyLike;
}

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
