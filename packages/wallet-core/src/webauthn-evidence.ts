import { bytesToBase64Url } from "./encoding.js";

// Server-verifiable WebAuthn evidence. PUBLIC artifacts only — NO key material:
// PRF output and private keys never appear; clientExtensionResults is emptied so
// the PRF result is never serialized out of the device. Shapes match
// @simplewebauthn/server's RegistrationResponseJSON / AuthenticationResponseJSON.

export interface AvokRegistrationEvidence {
  response: {
    id: string;
    rawId: string;
    type: "public-key";
    response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
    clientExtensionResults: Record<string, never>;
    authenticatorAttachment?: string;
  };
}

export interface AvokAssertionEvidence {
  response: {
    id: string;
    rawId: string;
    type: "public-key";
    response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string };
    clientExtensionResults: Record<string, never>;
    authenticatorAttachment?: string;
  };
}

const b64 = (buffer: ArrayBuffer): string => bytesToBase64Url(new Uint8Array(buffer));

/** Serialize a registration `PublicKeyCredential`; `clientExtensionResults` emptied so PRF never leaks. */
export function serializeRegistrationEvidence(
  credential: PublicKeyCredential,
  credentialId: string,
  transports: string[],
): AvokRegistrationEvidence {
  const response = credential.response as AuthenticatorAttestationResponse;
  return registrationEvidenceFromParts({
    credentialId,
    clientDataJSON: b64(response.clientDataJSON),
    attestationObject: b64(response.attestationObject),
    transports,
    authenticatorAttachment: credential.authenticatorAttachment,
  });
}

/** Serialize an assertion `PublicKeyCredential`; `clientExtensionResults` emptied so PRF never leaks. */
export function serializeAssertionEvidence(
  credential: PublicKeyCredential,
  credentialId: string,
): AvokAssertionEvidence {
  const response = credential.response as AuthenticatorAssertionResponse;
  return assertionEvidenceFromParts({
    credentialId,
    clientDataJSON: b64(response.clientDataJSON),
    authenticatorData: b64(response.authenticatorData),
    signature: b64(response.signature),
    userHandle: response.userHandle ? b64(response.userHandle) : null,
    authenticatorAttachment: credential.authenticatorAttachment,
  });
}

/**
 * Build `AvokAssertionEvidence` from plain string fields (e.g. as returned by react-native-passkey).
 * `clientExtensionResults` is always emptied so PRF never leaks.
 */
export function assertionEvidenceFromParts(parts: {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string | null;
  authenticatorAttachment?: string | null;
}): AvokAssertionEvidence {
  return {
    response: {
      id: parts.credentialId,
      rawId: parts.credentialId,
      type: "public-key",
      response: {
        clientDataJSON: parts.clientDataJSON,
        authenticatorData: parts.authenticatorData,
        signature: parts.signature,
        ...(parts.userHandle ? { userHandle: parts.userHandle } : {}),
      },
      clientExtensionResults: {},
      ...(parts.authenticatorAttachment ? { authenticatorAttachment: parts.authenticatorAttachment } : {}),
    },
  };
}

/**
 * Build `AvokRegistrationEvidence` from plain string fields (e.g. as returned by react-native-passkey).
 * `clientExtensionResults` is always emptied so PRF never leaks.
 */
export function registrationEvidenceFromParts(parts: {
  credentialId: string;
  clientDataJSON: string;
  attestationObject: string;
  transports?: string[];
  authenticatorAttachment?: string | null;
}): AvokRegistrationEvidence {
  const transports = parts.transports ?? [];
  return {
    response: {
      id: parts.credentialId,
      rawId: parts.credentialId,
      type: "public-key",
      response: {
        clientDataJSON: parts.clientDataJSON,
        attestationObject: parts.attestationObject,
        ...(transports.length ? { transports } : {}),
      },
      clientExtensionResults: {},
      ...(parts.authenticatorAttachment ? { authenticatorAttachment: parts.authenticatorAttachment } : {}),
    },
  };
}
