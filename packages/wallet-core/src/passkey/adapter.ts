import type { AvokAssertionEvidence, AvokRegistrationEvidence } from "../webauthn-evidence.js";

export interface PasskeyPrfProfile { extension: "prf"; saltVersion: "v0" }
export interface PasskeyPlatformMetadata { authenticatorAttachment: "platform" }

/** Result of creating a passkey credential. `prfOutput` never leaves the device boundary. */
export interface PasskeyRegistration {
  credentialId: string;
  prfOutput: ArrayBuffer;
  transports: string[];
  rpId: string;
  prf: PasskeyPrfProfile;
  platform: PasskeyPlatformMetadata;
}

/** Local index entry for one passkey/device. The slot id is derived from credentialId, never stored. */
export interface PasskeySlot {
  credentialId: string;
  rpId: string;
  transports?: string[];
  createdAt: string;
}

/** What a fresh device learns from its passkey alone. The handle says which kind of credential it is;
 *  a primary's handle carries no addresses, because it had none when it was created. */
export interface DiscoveredPasskey {
  credentialId: string;
  prfOutput: ArrayBuffer;
  userHandle: Uint8Array;
}

/** The single named error for every "the authenticator returned no PRF" path — at create, get, or
 *  discover, in either adapter. No PRF, no wallet; there is no fallback. `detail` appends adapter-
 *  specific context (e.g. a React Native version hint) without changing the user-facing guidance. */
export class NoPrfError extends Error {
  constructor(detail?: string) {
    super(
      "This passkey provider does not support the PRF extension, which Avok requires to derive your " +
        "wallet. Choose a different provider (for example iCloud Keychain or Google Password Manager)." +
        (detail ? ` ${detail}` : ""),
    );
    this.name = "NoPrfError";
  }
}

/**
 * The System-1 platform seam. Web and React Native ship concrete adapters; tests inject a fake.
 * The PRF output is the only secret it surfaces and is consumed inside the sandbox only.
 *
 * PRF-OUTPUT OWNERSHIP CONTRACT: the `ArrayBuffer` returned by `authenticate()`, `discover()`, and
 * `authenticateWithEvidence()` (the `prfOutput`) is TRANSFERRED to the caller and is SINGLE-USE. The
 * sandbox zeroes it after deriving K (derive → use → clear), so an adapter MUST return a FRESH buffer
 * per call and MUST NOT retain or re-return it. Production adapters (passkey/web.ts, passkey/native.ts)
 * already satisfy this — each assertion yields a new PRF output that is never kept. Fakes must too.
 */
export interface PasskeyAdapter {
  create(label: string, userHandle: Uint8Array): Promise<PasskeyRegistration>;
  authenticate(credentialId: string, transports?: string[]): Promise<ArrayBuffer>;
  /**
   * Discover a credential for this rpId and evaluate its PRF.
   *
   * `credentialId` constrains the assertion to ONE credential, so the browser goes straight to
   * biometrics instead of showing the account picker. Pass it when the session already knows which
   * passkey it is (every popup after login); omit it when the user must CHOOSE (login itself, or a
   * wallet this device has never seen) — constraining there would make picking impossible.
   */
  discover(opts?: { credentialId?: string }): Promise<DiscoveredPasskey>;
  authenticateWithEvidence?(
    credentialId: string,
    transports: string[] | undefined,
    challenge: string,
  ): Promise<{ prfOutput: ArrayBuffer; assertion: AvokAssertionEvidence }>;
  createWithEvidence?(
    label: string,
    userHandle: Uint8Array,
    challenge: string,
  ): Promise<PasskeyRegistration & { registration: AvokRegistrationEvidence }>;
}
