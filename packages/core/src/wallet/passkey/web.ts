import { base64UrlToBytes, bytesToArrayBuffer, bytesToBase64Url } from "../encoding.js";
import { getPrfSalt } from "../crypto/derive-wallet.js";
import type { DiscoveredPasskey, PasskeyAdapter, PasskeyRegistration } from "./adapter.js";
import { MissingRpIdError, NoPrfError } from "./adapter.js";

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

  async create(label: string, userHandle: Uint8Array): Promise<PasskeyRegistration> {
    const rpId = this.rpId;
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
        rpId: this.rpId, challenge: bytesToArrayBuffer(randomBytes(32)),
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
        rpId: this.rpId, challenge: bytesToArrayBuffer(randomBytes(32)),
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
}
