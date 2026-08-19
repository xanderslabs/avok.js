// A real Avok wallet for E2E scripts, built with the SAME `createWallet` ceremony production code
// runs, over a `FakePasskeyAdapter` in place of a real authenticator (no browser in a Node E2E
// script). K = HKDF(PRF) is derived exactly as it would be for a real passkey — the ONLY thing fake
// is where the PRF bytes come from. Deterministic per (seed, rpId), so a script that persists `seed`
// can reconstruct the SAME address in a later process (the guardian-recovery leg's real 1h wait spans
// multiple invocations).
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createWallet } from "../../src/wallet/wallet.js";
import type { WalletState } from "../../src/wallet/sandbox.js";
import type { PasskeyAdapter, PasskeyRegistration, DiscoveredPasskey } from "../../src/wallet/passkey/adapter.js";
import { bytesToBase64Url } from "../../src/wallet/encoding.js";

interface FakeCredential {
  prfOutput: ArrayBuffer;
  userHandle: Uint8Array;
}

/** Deterministic per (rpId, seed) — see test/client/fakes.ts's FakePasskeyAdapter, which this mirrors
 *  exactly (same credentialId/prfOutput formula) so a persisted `seed` reconstructs the identical key. */
class DeterministicFakePasskey implements PasskeyAdapter {
  private readonly credentials = new Map<string, FakeCredential>();
  private counter = 0;
  private firstCredentialId: string | null = null;

  constructor(
    private readonly rpId: string,
    private readonly seed: number,
  ) {}

  async create(_label: string, userHandle: Uint8Array): Promise<PasskeyRegistration> {
    this.counter += 1;
    const plainId = `fake-cred-${this.seed}-${this.counter}`;
    const credentialId = bytesToBase64Url(new TextEncoder().encode(plainId));
    const prfOutput = new Uint8Array(
      Array.from({ length: 32 }, (_, i) => (this.seed + this.counter * 31 + i) % 256),
    ).buffer;
    this.credentials.set(credentialId, { prfOutput: prfOutput.slice(0), userHandle });
    if (!this.firstCredentialId) this.firstCredentialId = credentialId;
    return {
      credentialId,
      prfOutput,
      transports: ["internal"],
      rpId: this.rpId,
      prf: { extension: "prf", saltVersion: "v0" },
      platform: { authenticatorAttachment: "platform" },
    };
  }

  async authenticate(credentialId: string): Promise<ArrayBuffer> {
    const cred = this.credentials.get(credentialId);
    if (!cred) throw new Error(`DeterministicFakePasskey: unknown credential ${credentialId}`);
    return cred.prfOutput.slice(0);
  }

  async discover(): Promise<DiscoveredPasskey> {
    const id = this.firstCredentialId;
    if (!id) throw new Error("DeterministicFakePasskey: no credential yet");
    const cred = this.credentials.get(id)!;
    return { credentialId: id, prfOutput: cred.prfOutput.slice(0), userHandle: cred.userHandle };
  }
}

export interface E2eWalletHandle {
  state: WalletState;
  passkey: PasskeyAdapter;
  /** Persist this — it is everything needed to reconstruct the identical key later. */
  seed: number;
  rpId: string;
}

/** Mints a fresh Avok wallet (founding device: evmAddress === walletAddress). */
export async function createFreshAvokWallet(opts: { networkName: string; rpId?: string }): Promise<E2eWalletHandle> {
  const seed = Math.floor(Math.random() * 0xffffffff);
  const rpId = opts.rpId ?? "e2e-base-sepolia.avok.test";
  const passkey = new DeterministicFakePasskey(rpId, seed);
  const { state } = await createWallet({ passkey, networkName: opts.networkName });
  return { state, passkey, seed, rpId };
}

/** Rebuilds the same wallet handle from a persisted `{seed, rpId, state}` — used by scripts that
 *  resume after a real-time wait (e.g. the 1h guardian recovery timelock). A fresh
 *  `DeterministicFakePasskey` starts with an EMPTY credential map, so `withWalletKey`'s
 *  `authenticate(state.credentialId)` would find nothing — replaying the SAME first `create()` call
 *  (seed/counter-deterministic, so it reproduces the IDENTICAL credentialId + prfOutput) repopulates
 *  it before handing the handle back. */
export async function reconstructAvokWallet(saved: {
  seed: number;
  rpId: string;
  state: WalletState;
}): Promise<E2eWalletHandle> {
  const passkey = new DeterministicFakePasskey(saved.rpId, saved.seed);
  const registration = await passkey.create("reconstructed", new Uint8Array(33));
  if (registration.credentialId !== saved.state.credentialId) {
    throw new Error(
      `reconstructAvokWallet: replayed credentialId "${registration.credentialId}" does not match ` +
        `the persisted state's "${saved.state.credentialId}" — seed/rpId mismatch`,
    );
  }
  return { state: saved.state, passkey, seed: saved.seed, rpId: saved.rpId };
}

/** A fresh, throwaway secp256k1 keypair for a "bring-your-own" guardian (PRD's key-import branch) —
 *  never derived from any passkey, never reused as a wallet owner key. */
export function generateGuardianKey(): { privateKey: `0x${string}`; address: Address } {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}
