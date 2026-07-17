import { describe, expect, it } from "vitest";
import {
  assertionEvidenceFromParts,
  registrationEvidenceFromParts,
  serializeAssertionEvidence,
  serializeRegistrationEvidence,
} from "../src/webauthn-evidence.js";

const buf = (s: string) => new TextEncoder().encode(s).buffer;

function fakeAssertion() {
  return {
    authenticatorAttachment: "platform",
    response: { clientDataJSON: buf("cdj"), authenticatorData: buf("ad"), signature: buf("sig"), userHandle: buf("uh") },
  } as unknown as PublicKeyCredential;
}
function fakeAssertionNoUserHandle() {
  return {
    authenticatorAttachment: "platform",
    response: { clientDataJSON: buf("cdj"), authenticatorData: buf("ad"), signature: buf("sig"), userHandle: null },
  } as unknown as PublicKeyCredential;
}
function fakeRegistration() {
  return {
    authenticatorAttachment: "platform",
    response: { clientDataJSON: buf("cdj"), attestationObject: buf("att") },
  } as unknown as PublicKeyCredential;
}

describe("webauthn-evidence", () => {
  it("serializes an assertion and empties clientExtensionResults (PRF never leaks)", () => {
    const ev = serializeAssertionEvidence(fakeAssertion(), "cred-1");
    expect(ev.response.id).toBe("cred-1");
    expect(ev.response.type).toBe("public-key");
    expect(ev.response.response.authenticatorData).toBeTypeOf("string");
    expect(ev.response.response.userHandle).toBeTypeOf("string");
    expect(ev.response.clientExtensionResults).toEqual({});
  });

  it("serializes an assertion with no userHandle — omits the key entirely", () => {
    const ev = serializeAssertionEvidence(fakeAssertionNoUserHandle(), "cred-3");
    expect("userHandle" in ev.response.response).toBe(false);
    expect(ev.response.clientExtensionResults).toEqual({});
  });

  it("serializes a registration with attestationObject and empty extensions", () => {
    const ev = serializeRegistrationEvidence(fakeRegistration(), "cred-2", ["internal"]);
    expect(ev.response.response.attestationObject).toBeTypeOf("string");
    expect(ev.response.response.transports).toEqual(["internal"]);
    expect(ev.response.clientExtensionResults).toEqual({});
  });

  it("serializes a registration with empty transports — omits the key entirely", () => {
    const ev = serializeRegistrationEvidence(fakeRegistration(), "cred-4", []);
    expect("transports" in ev.response.response).toBe(false);
    expect(ev.response.clientExtensionResults).toEqual({});
  });
});

describe("webauthn-evidence fromParts helpers", () => {
  it("assertionEvidenceFromParts sets empty clientExtensionResults and omits absent userHandle", () => {
    const ev = assertionEvidenceFromParts({
      credentialId: "c1",
      clientDataJSON: "cdj",
      authenticatorData: "ad",
      signature: "sig",
    });
    expect(ev.response.id).toBe("c1");
    expect(ev.response.rawId).toBe("c1");
    expect(ev.response.type).toBe("public-key");
    expect(ev.response.clientExtensionResults).toEqual({});
    expect("userHandle" in ev.response.response).toBe(false);
    expect("authenticatorAttachment" in ev.response).toBe(false);
  });

  it("assertionEvidenceFromParts includes userHandle and authenticatorAttachment when provided", () => {
    const ev = assertionEvidenceFromParts({
      credentialId: "c2",
      clientDataJSON: "cdj",
      authenticatorData: "ad",
      signature: "sig",
      userHandle: "uh",
      authenticatorAttachment: "platform",
    });
    expect(ev.response.response.userHandle).toBe("uh");
    expect(ev.response.authenticatorAttachment).toBe("platform");
  });

  it("assertionEvidenceFromParts omits userHandle when null", () => {
    const ev = assertionEvidenceFromParts({
      credentialId: "c3",
      clientDataJSON: "cdj",
      authenticatorData: "ad",
      signature: "sig",
      userHandle: null,
    });
    expect("userHandle" in ev.response.response).toBe(false);
  });

  it("registrationEvidenceFromParts sets empty clientExtensionResults and omits empty transports", () => {
    const ev = registrationEvidenceFromParts({
      credentialId: "r1",
      clientDataJSON: "cdj",
      attestationObject: "att",
      transports: [],
    });
    expect(ev.response.id).toBe("r1");
    expect(ev.response.clientExtensionResults).toEqual({});
    expect("transports" in ev.response.response).toBe(false);
    expect("authenticatorAttachment" in ev.response).toBe(false);
  });

  it("registrationEvidenceFromParts includes transports when non-empty", () => {
    const ev = registrationEvidenceFromParts({
      credentialId: "r2",
      clientDataJSON: "cdj",
      attestationObject: "att",
      transports: ["internal"],
    });
    expect(ev.response.response.transports).toEqual(["internal"]);
  });
});
