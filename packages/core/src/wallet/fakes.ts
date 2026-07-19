import type { Address, Hex } from "viem";
import type { DiscoveredPasskey, PasskeyAdapter, PasskeyRegistration } from "./passkey/adapter.js";
import type { VaultReader } from "./vault.js";
import { bytesToBase64Url } from "./encoding.js";

interface FakeCredential { prfOutput: ArrayBuffer; userHandle: Uint8Array }

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
    const prfOutput = new Uint8Array(
      Array.from({ length: 32 }, (_, i) => (this.seed + this.counter * 31 + i) % 256),
    ).buffer;
    this.credentials.set(credentialId, { prfOutput, userHandle });
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

/** In-memory access vault keyed by address → slotId → blob bytes. */
export class FakeVaultReader implements VaultReader {
  private readonly store = new Map<string, Map<string, Uint8Array>>();
  set(address: Address, slotId: Hex, bytes: Uint8Array): void {
    const key = address.toLowerCase();
    if (!this.store.has(key)) this.store.set(key, new Map());
    this.store.get(key)!.set(slotId.toLowerCase(), bytes);
  }
  async getAccessSlot(address: Address, slotId: Hex): Promise<Uint8Array | null> {
    return this.store.get(address.toLowerCase())?.get(slotId.toLowerCase()) ?? null;
  }
  async listAccessSlotIds(address: Address): Promise<Hex[]> {
    return [...(this.store.get(address.toLowerCase())?.keys() ?? [])] as Hex[];
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
