import type { DiscoveredPasskey, PasskeyAdapter, PasskeyRegistration } from "../../src/wallet/passkey/adapter.js";
import { bytesToBase64Url } from "../../src/wallet/encoding.js";

interface FakeCredential {
  prfOutput: ArrayBuffer;
  userHandle: Uint8Array;
}

/** In-memory WebAuthn stand-in: deterministic per-credential PRF. `discover()` surfaces the most
 *  recently created credential's opaque user handle, exactly as a real authenticator would. */
export class FakePasskeyAdapter implements PasskeyAdapter {
  private readonly credentials = new Map<string, FakeCredential>();
  private readonly seed = Math.floor(Math.random() * 0xffff);
  private counter = 0;

  async create(_label: string, userHandle: Uint8Array): Promise<PasskeyRegistration> {
    this.counter += 1;
    const plainId = `fake-cred-${this.seed}-${this.counter}`;
    const credentialId = bytesToBase64Url(new TextEncoder().encode(plainId));
    const prfOutput = new Uint8Array(Array.from({ length: 32 }, (_, i) => (this.seed + this.counter * 31 + i) % 256))
      .buffer;
    // Store an INDEPENDENT copy: the PRF-output ownership contract (see PasskeyAdapter) says a
    // returned buffer is single-use and the caller may wipe it. If the map kept this exact
    // reference, a caller wiping its `create()` result would zero the credential's PRF for every
    // later authenticate()/discover() too — a fake aliasing bug, not a real adapter's behavior.
    this.credentials.set(credentialId, { prfOutput: prfOutput.slice(0), userHandle });
    return {
      credentialId,
      prfOutput,
      transports: ["internal"],
      rpId: "qudi.fi",
      prf: { extension: "prf", saltVersion: "v0" },
      platform: { authenticatorAttachment: "platform" },
    };
  }

  async authenticate(credentialId: string, _transports?: string[]): Promise<ArrayBuffer> {
    const cred = this.credentials.get(credentialId);
    if (!cred) throw new Error(`Unknown passkey credential: ${credentialId}`);
    // Fresh buffer per call: the sandbox zeroes prfOutput after use (single-use adapter contract).
    return cred.prfOutput.slice(0);
  }

  async discover(): Promise<DiscoveredPasskey> {
    const entry = [...this.credentials.entries()].at(-1);
    if (!entry) throw new Error("No passkey to discover");
    return { credentialId: entry[0], prfOutput: entry[1].prfOutput.slice(0), userHandle: entry[1].userHandle };
  }
}

/** A `PasskeyAdapter` that counts biometric gestures. Backed by a primary-style fake so
 * `createWallet` sets up a discover() target that reconstructs K from PRF — no second gesture. */
export interface CountingPasskey extends PasskeyAdapter {
  readonly counts: { discover: number; authenticate: number };
}

export function makeFakePasskeyWithCounters(): CountingPasskey {
  const inner = new FakePasskeyAdapter();
  const counts = { discover: 0, authenticate: 0 };
  return {
    counts,
    create: (label, userHandle) => inner.create(label, userHandle),
    authenticate: (credentialId, transports) => {
      counts.authenticate++;
      return inner.authenticate(credentialId, transports);
    },
    discover: () => {
      counts.discover++;
      return inner.discover();
    },
  };
}
