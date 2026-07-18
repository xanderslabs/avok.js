import { base64UrlToBytes, bytesToBase64Url } from "../encoding.js";
import type { DiscoveredPasskey, PasskeyAdapter, PasskeyRegistration } from "./adapter.js";
import { NoPrfError } from "./adapter.js";
import { getPrfSalt } from "./web.js";
import {
  assertionEvidenceFromParts,
  registrationEvidenceFromParts,
  type AvokAssertionEvidence,
  type AvokRegistrationEvidence,
} from "../webauthn-evidence.js";

interface PrfExtResults {
  prf?: { results?: { first?: string } };
}
export interface ReactNativePasskeyCreateResult {
  id: string;
  response?: { transports?: string[]; clientDataJSON?: string; attestationObject?: string };
  clientExtensionResults?: PrfExtResults;
  /** "platform" | "cross-platform" when the RN module surfaces it; used to reject roaming authenticators. */
  authenticatorAttachment?: string;
}
export interface ReactNativePasskeyGetResult {
  id: string;
  response?: { userHandle?: string | null; clientDataJSON?: string; authenticatorData?: string; signature?: string };
  clientExtensionResults?: PrfExtResults;
  /** "platform" | "cross-platform" when the RN module surfaces it; used to reject roaming authenticators. */
  authenticatorAttachment?: string;
}
export interface ReactNativePasskeyLike {
  create(request: Record<string, unknown>): Promise<ReactNativePasskeyCreateResult>;
  get(request: Record<string, unknown>): Promise<ReactNativePasskeyGetResult>;
}

function readPrf(results: PrfExtResults | undefined): ArrayBuffer | undefined {
  const first = results?.prf?.results?.first;
  if (!first) return undefined;
  const bytes = base64UrlToBytes(first);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
const PRF_HINT = "This needs react-native-passkey v3.3+ and a PRF-capable authenticator.";
const CROSS_DEVICE_REJECTED =
  "This wallet's passkey is not a platform authenticator on this device. Provision this device its own passkey instead.";

/** Mirror of web's assertLocal: reject a roaming (cross-platform) authenticator when the RN module surfaces
 *  its attachment. RN platform-passkey modules are platform-bound by construction; this guards the case where
 *  a module ever exposes/returns a cross-platform credential. */
function assertLocalNative(attachment?: string): void {
  if (attachment === "cross-platform") throw new Error(CROSS_DEVICE_REJECTED);
}

/** Build a PasskeyAdapter over an injected `react-native-passkey` module (no hard RN dep). */
export function createReactNativePasskeyAdapter(
  passkeyModule: ReactNativePasskeyLike,
  options: { rpId: string; rpName?: string },
): PasskeyAdapter {
  const rpName = options.rpName ?? options.rpId;
  const rpId = options.rpId;
  const prfSalt = bytesToBase64Url(getPrfSalt());
  const randomChallenge = () => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));

  async function authenticate(credentialId: string, transports?: string[]): Promise<ArrayBuffer> {
    const result = await passkeyModule.get({
      challenge: randomChallenge(), rpId,
      allowCredentials: [{ type: "public-key", id: credentialId, ...(transports?.length ? { transports } : {}) }],
      userVerification: "required", extensions: { prf: { eval: { first: prfSalt } } },
    });
    assertLocalNative(result.authenticatorAttachment);
    const prf = readPrf(result.clientExtensionResults);
    if (!prf) throw new NoPrfError(PRF_HINT);
    return prf;
  }

  return {
    async create(label: string, userHandle: Uint8Array): Promise<PasskeyRegistration> {
      const result = await passkeyModule.create({
        rp: { name: rpName, id: rpId },
        user: { id: bytesToBase64Url(userHandle), name: label, displayName: label },
        challenge: randomChallenge(),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: prfSalt } } },
      });
      const transports = result.response?.transports ?? [];
      // authenticate() throws NoPrfError if the get() fallback also yields no PRF, so prfOutput is defined.
      const prfOutput = readPrf(result.clientExtensionResults) ?? (await authenticate(result.id, transports));
      return {
        credentialId: result.id, prfOutput, transports, rpId,
        prf: { extension: "prf", saltVersion: "v0" }, platform: { authenticatorAttachment: "platform" },
      };
    },
    authenticate,
    async discover(opts?: { credentialId?: string }): Promise<DiscoveredPasskey> {
      // Same contract as web: a credentialId constrains the assertion to ONE credential, so the OS
      // prompts for that passkey directly rather than showing a chooser.
      const result = await passkeyModule.get({
        challenge: randomChallenge(), rpId, userVerification: "required",
        ...(opts?.credentialId
          ? { allowCredentials: [{ type: "public-key", id: opts.credentialId }] }
          : {}),
        extensions: { prf: { eval: { first: prfSalt } } },
      });
      assertLocalNative(result.authenticatorAttachment);
      const prfOutput = readPrf(result.clientExtensionResults);
      if (!prfOutput) throw new NoPrfError(PRF_HINT);
      const handle = result.response?.userHandle;
      if (!handle) throw new Error("Passkey assertion returned no user handle");
      return { credentialId: result.id, prfOutput, userHandle: base64UrlToBytes(handle) };
    },

    /**
     * Uses the server-supplied challenge; returns PRF key material for local decryption and
     * a serialized assertion for server verification. `clientExtensionResults` is emptied.
     * Device-gated: requires react-native-passkey v3.3+ with PRF support.
     */
    async authenticateWithEvidence(
      credentialId: string,
      transports: string[] | undefined,
      challenge: string,
    ): Promise<{ prfOutput: ArrayBuffer; assertion: AvokAssertionEvidence }> {
      const result = await passkeyModule.get({
        challenge, rpId,
        allowCredentials: [{ type: "public-key", id: credentialId, ...(transports?.length ? { transports } : {}) }],
        userVerification: "required", extensions: { prf: { eval: { first: prfSalt } } },
      });
      assertLocalNative(result.authenticatorAttachment);
      const prf = readPrf(result.clientExtensionResults);
      if (!prf) throw new NoPrfError(PRF_HINT);
      const assertion = assertionEvidenceFromParts({
        credentialId,
        clientDataJSON: result.response?.clientDataJSON ?? "",
        authenticatorData: result.response?.authenticatorData ?? "",
        signature: result.response?.signature ?? "",
        userHandle: result.response?.userHandle,
      });
      return { prfOutput: prf, assertion };
    },

    /**
     * Uses the server-supplied challenge; returns the PasskeyRegistration plus a serialized
     * registration credential for server verification. Device-gated.
     */
    async createWithEvidence(
      label: string,
      userHandle: Uint8Array,
      challenge: string,
    ): Promise<PasskeyRegistration & { registration: AvokRegistrationEvidence }> {
      const result = await passkeyModule.create({
        rp: { name: rpName, id: rpId },
        user: { id: bytesToBase64Url(userHandle), name: label, displayName: label },
        challenge,
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: prfSalt } } },
      });
      const transports = result.response?.transports ?? [];
      // authenticate() throws NoPrfError if the get() fallback also yields no PRF, so prfOutput is defined.
      const prfOutput = readPrf(result.clientExtensionResults) ?? (await authenticate(result.id, transports));
      const registration = registrationEvidenceFromParts({
        credentialId: result.id,
        clientDataJSON: result.response?.clientDataJSON ?? "",
        attestationObject: result.response?.attestationObject ?? "",
        transports,
      });
      return {
        credentialId: result.id, prfOutput, transports, rpId,
        prf: { extension: "prf", saltVersion: "v0" }, platform: { authenticatorAttachment: "platform" },
        registration,
      };
    },
  };
}
