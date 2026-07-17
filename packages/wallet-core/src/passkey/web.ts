import { base64UrlToBytes, bytesToArrayBuffer, bytesToBase64Url } from "../encoding.js";
import type { DiscoveredPasskey, PasskeyAdapter, PasskeyRegistration } from "./adapter.js";
import { NoPrfError } from "./adapter.js";
import { serializeAssertionEvidence, serializeRegistrationEvidence } from "../webauthn-evidence.js";
import type { AvokAssertionEvidence, AvokRegistrationEvidence } from "../webauthn-evidence.js";

let prfSaltCache: Uint8Array | undefined;
/**
 * The PRF salt — the FIRST input to the entire key chain: PRF = authenticator(salt), K = HKDF(PRF).
 *
 * It is therefore as NORMATIVE as the HKDF domains in crypto/derive-wallet.ts, and vendor-neutral for
 * the same reason: the PRF output is deterministic per (credential, salt), so any conforming
 * implementation that opens the same passkey — a replacement app on the same domain, a sibling app
 * sharing the rpId, a second implementer of the standard — MUST pass byte-identical salt bytes or it
 * derives a different K and silently lands in a DIFFERENT WALLET. A vendor's name here would make
 * every other implementer recite it in their crypto.
 *
 * Changing this value changes every K, i.e. every wallet. It is frozen the moment real users hold
 * value. Native adapters MUST use the same salt (see passkey/native.ts).
 */
export function getPrfSalt(): Uint8Array {
  return (prfSaltCache ??= new TextEncoder().encode("passkey-access-vault/prf-salt/v0"));
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function readPrf(credential: PublicKeyCredential): ArrayBuffer | undefined {
  return (credential.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
}

const CROSS_DEVICE_REJECTED =
  "This wallet's passkey is not on this device. Provision this device its own passkey instead.";
const LOCAL_HINTS = ["client-device"] as const;

function assertLocal(assertion: PublicKeyCredential): void {
  if (assertion.authenticatorAttachment === "cross-platform") throw new Error(CROSS_DEVICE_REJECTED);
}

/**
 * Thrown when an adapter is constructed without an rpId.
 *
 * The rpId is not configuration, it is the KEY SCOPE. K = HKDF(PRF(credential, rpId)), so the rpId
 * decides which wallet a passkey opens — and every origin matching it can derive that key.
 *
 * This used to default to `window.location.hostname`, which is wrong in both directions and silently:
 *
 *   - it is not always the rpId. An origin on a subdomain (auth.example.com) legitimately asserts the
 *     APEX (example.com). Inferring finds no passkey there, or worse, mints one under a scope the
 *     operator never chose.
 *   - it makes the key scope a function of the URL. Serve the same app from app.example.com and
 *     example.com and the user has TWO DIFFERENT WALLETS, with no error to say so.
 *
 * Every other surface in this codebase already refuses to guess (auth-origin's MissingRpIdError,
 * the demos' VITE_RP_ID check, the native adapter's required `rpId`). This one was the last place an
 * rpId could be inferred, and it is a published class.
 */
export class MissingRpIdError extends Error {
  constructor() {
    super(
      "WebAuthnPasskeyAdapter requires an explicit rpId. The rpId scopes the passkey PRF that IS the " +
        "wallet key (K = HKDF(PRF(credential, rpId))) — it must be pinned by the operator, never " +
        'inferred from a URL or hostname. Pass e.g. { rpId: "example.com" }.',
    );
    this.name = "MissingRpIdError";
  }
}

/** Real WebAuthn adapter: discoverable platform credential + PRF. Browser-only. */
export class WebAuthnPasskeyAdapter implements PasskeyAdapter {
  // The WebAuthn RP display name ("Sign in to <rpName>"). Operator-supplied; NEVER a hardcoded app
  // name. When unset it defaults to the rpId at ceremony time (see rp.name below) — honest, and it
  // keeps the display in lockstep with the actual key scope. Own-origin apps should pass an operatorName.
  private readonly rpName?: string;
  private readonly rpId: string;
  constructor(options: { rpName?: string; rpId: string }) {
    // Fail loud at CONSTRUCTION, not at the ceremony: an adapter that cannot name its key scope must
    // not exist. Guarded at runtime too — `rpId` is typed as required, but a JS caller, a config
    // read from env, or an `as any` can still deliver undefined or "".
    if (typeof options?.rpId !== "string" || options.rpId.trim() === "") throw new MissingRpIdError();
    this.rpName = options.rpName;
    this.rpId = options.rpId;
  }
  private resolveRpId(): string {
    return this.rpId;
  }

  async create(label: string, userHandle: Uint8Array): Promise<PasskeyRegistration> {
    const rpId = this.resolveRpId();
    const credential = (await navigator.credentials.create({
      publicKey: {
        rp: { name: this.rpName ?? rpId, id: rpId },
        user: { id: bytesToArrayBuffer(userHandle), name: label, displayName: label },
        challenge: bytesToArrayBuffer(randomBytes(32)),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: getPrfSalt() } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("Passkey creation was cancelled");
    const credentialId = bytesToBase64Url(new Uint8Array(credential.rawId));
    const transports = (credential.response as AuthenticatorAttestationResponse).getTransports?.() ?? [];
    // If create() returned no PRF, retry via a get() ceremony; authenticate() itself throws
    // NoPrfError if that also yields nothing. So prfOutput here is always defined key material.
    const prfOutput = readPrf(credential) ?? (await this.authenticate(credentialId, transports));
    return {
      credentialId, prfOutput, transports, rpId,
      prf: { extension: "prf", saltVersion: "v0" }, platform: { authenticatorAttachment: "platform" },
    };
  }

  private allow(credentialId: string, transports?: string[]): PublicKeyCredentialDescriptor {
    return { type: "public-key", id: bytesToArrayBuffer(base64UrlToBytes(credentialId)),
      ...(transports?.length ? { transports: transports as AuthenticatorTransport[] } : {}) };
  }

  async authenticate(credentialId: string, transports?: string[]): Promise<ArrayBuffer> {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        rpId: this.resolveRpId(), challenge: bytesToArrayBuffer(randomBytes(32)),
        allowCredentials: [this.allow(credentialId, transports)], userVerification: "required", hints: LOCAL_HINTS,
        extensions: { prf: { eval: { first: getPrfSalt() } } },
      } as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;
    if (!assertion) throw new Error("Passkey authentication was cancelled");
    assertLocal(assertion);
    const prf = readPrf(assertion);
    if (!prf) throw new NoPrfError();
    return prf;
  }

  async discover(opts?: { credentialId?: string }): Promise<DiscoveredPasskey> {
    // A credentialId constrains the assertion to ONE credential: the browser prompts for that
    // passkey directly instead of showing the account picker. Omitted → the picker, which is what a
    // LOGIN needs (the user is choosing, possibly a wallet this device has never seen).
    const allowCredentials = opts?.credentialId ? [this.allow(opts.credentialId)] : undefined;

    const assertion = (await navigator.credentials.get({
      publicKey: {
        rpId: this.resolveRpId(), challenge: bytesToArrayBuffer(randomBytes(32)),
        ...(allowCredentials ? { allowCredentials } : {}),
        userVerification: "required", hints: LOCAL_HINTS, extensions: { prf: { eval: { first: getPrfSalt() } } },
      } as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;
    if (!assertion) throw new Error("Passkey discovery was cancelled");
    assertLocal(assertion);
    const prf = readPrf(assertion);
    if (!prf) throw new NoPrfError();
    const handle = (assertion.response as AuthenticatorAssertionResponse).userHandle;
    if (!handle) throw new Error("Passkey assertion returned no user handle");
    return { credentialId: bytesToBase64Url(new Uint8Array(assertion.rawId)), prfOutput: prf, userHandle: new Uint8Array(handle) };
  }

  /**
   * Like `authenticate`, but uses a server-supplied challenge and returns BOTH the PRF key
   * material (for local decryption) and a serialized assertion (for server verification).
   * `clientExtensionResults` is emptied by `serializeAssertionEvidence` so PRF never leaks.
   */
  async authenticateWithEvidence(
    credentialId: string,
    transports: string[] | undefined,
    challenge: string,
  ): Promise<{ prfOutput: ArrayBuffer; assertion: AvokAssertionEvidence }> {
    const credential = (await navigator.credentials.get({
      publicKey: {
        rpId: this.resolveRpId(),
        challenge: bytesToArrayBuffer(base64UrlToBytes(challenge)),
        allowCredentials: [this.allow(credentialId, transports)],
        userVerification: "required",
        hints: LOCAL_HINTS,
        extensions: { prf: { eval: { first: getPrfSalt() } } },
      } as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("Passkey authentication was cancelled");
    assertLocal(credential);
    const prfOutput = readPrf(credential);
    if (!prfOutput) throw new NoPrfError();
    return { prfOutput, assertion: serializeAssertionEvidence(credential, credentialId) };
  }

  /**
   * Like `create`, but uses a server-supplied challenge and additionally returns a serialized
   * registration credential for server verification. `clientExtensionResults` is emptied so PRF
   * never leaks into the evidence.
   */
  async createWithEvidence(
    label: string,
    userHandle: Uint8Array,
    challenge: string,
  ): Promise<PasskeyRegistration & { registration: AvokRegistrationEvidence }> {
    const rpId = this.resolveRpId();
    const credential = (await navigator.credentials.create({
      publicKey: {
        rp: { name: this.rpName ?? rpId, id: rpId },
        user: { id: bytesToArrayBuffer(userHandle), name: label, displayName: label },
        challenge: bytesToArrayBuffer(base64UrlToBytes(challenge)),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: getPrfSalt() } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("Passkey creation was cancelled");
    const credentialId = bytesToBase64Url(new Uint8Array(credential.rawId));
    const transports = (credential.response as AuthenticatorAttestationResponse).getTransports?.() ?? [];
    // authenticate() throws NoPrfError if the get() fallback also yields no PRF, so prfOutput is defined.
    const prfOutput = readPrf(credential) ?? (await this.authenticate(credentialId, transports));
    return {
      credentialId, prfOutput, transports, rpId,
      prf: { extension: "prf", saltVersion: "v0" }, platform: { authenticatorAttachment: "platform" },
      registration: serializeRegistrationEvidence(credential, credentialId, transports),
    };
  }
}
