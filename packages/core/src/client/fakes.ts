import type { Address, Hex } from "viem";
import type { Call } from "../evm/index.js";
import type { SigningChannel, ChannelRequest } from "../channel/index.js";
import type { DiscoveredPasskey, PasskeyAdapter, PasskeyRegistration } from "../wallet/index.js";
import { bytesToBase64Url } from "../wallet/index.js";
import type { RpcClient, SimulateArgs, SimCallResult, ReadArgs } from "../evm/index.js";

/** One fake credential: the opaque user handle it was created with (primary or secondary), plus a
 *  FIXED PRF output. Fixed + deterministic is the whole point — "same passkey ⇒ same wallet", because
 *  K = HKDF(PRF) and both chains' keys derive from K. There is no largeBlob: the extension is gone. */
interface FakeCredential { prfOutput: ArrayBuffer; userHandle: Uint8Array }

/** In-memory WebAuthn stand-in on the CURRENT seam: `create(label, userHandle)` stores the opaque
 *  handle, `discover()` surfaces `{ credentialId, prfOutput, userHandle }`. Models wallet-core's
 *  FakePasskeyAdapter. The PRF is derived deterministically from a per-instance seed, so two
 *  connections sharing one adapter reconstruct the identical wallet. */
class FakePasskeyAdapter implements PasskeyAdapter {
  private readonly credentials = new Map<string, FakeCredential>();
  private readonly seed: number;
  private counter = 0;
  private firstCredentialId: string | null = null;
  private activeCredentialId: string | null = null;
  /** Every label passed to create(), in order — lets a test assert the wallet-label prefix. */
  readonly createdLabels: string[] = [];

  constructor(private readonly rpId: string, seed?: number) {
    this.seed = seed ?? Math.floor(Math.random() * 0xffff);
  }

  /** Returns all credential IDs in creation order. Useful in tests to target a specific slot. */
  allCredentialIds(): string[] {
    return [...this.credentials.keys()];
  }

  /**
   * Override which credential `discover()` returns. Pass a `credentialId` from
   * `allCredentialIds()` to simulate a user presenting a specific passkey (e.g. slot 2 after
   * `addPasskey`). Test-only — does not affect production signing behavior.
   */
  setDiscoveredCredential(credentialId: string): void {
    if (!this.credentials.has(credentialId)) {
      throw new Error(`FakePasskeyAdapter.setDiscoveredCredential: unknown credentialId ${credentialId}`);
    }
    this.activeCredentialId = credentialId;
  }

  async create(label: string, userHandle: Uint8Array): Promise<PasskeyRegistration> {
    this.createdLabels.push(label);
    this.counter += 1;
    const plainId = `fake-cred-${this.seed}-${this.counter}`;
    const credentialId = bytesToBase64Url(new TextEncoder().encode(plainId));
    const prfOutput = new Uint8Array(
      Array.from({ length: 32 }, (_, i) => (this.seed + this.counter * 31 + i) % 256),
    ).buffer;
    this.credentials.set(credentialId, { prfOutput, userHandle });
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

  async authenticate(credentialId: string, _transports?: string[]): Promise<ArrayBuffer> {
    const cred = this.credentials.get(credentialId);
    if (!cred) throw new Error(`Unknown passkey credential: ${credentialId}`);
    // Fresh buffer per call: the sandbox zeroes prfOutput after use (single-use adapter contract).
    return cred.prfOutput.slice(0);
  }

  async discover(): Promise<DiscoveredPasskey> {
    const id = this.activeCredentialId ?? this.firstCredentialId;
    if (!id) throw new Error("No passkey to discover");
    const cred = this.credentials.get(id)!;
    return { credentialId: id, prfOutput: cred.prfOutput.slice(0), userHandle: cred.userHandle };
  }
}

export type FakePasskey = PasskeyAdapter & {
  /** Every label passed to create(), in order — lets a test assert the wallet-label prefix. */
  readonly createdLabels: string[];
  /** All credential IDs in creation order — lets tests target a specific slot. */
  allCredentialIds(): string[];
  /**
   * Set which credential `discover()` returns. Simulates presenting a specific passkey (e.g.
   * slot 2 after `addPasskey`) without touching production signing behavior.
   */
  setDiscoveredCredential(credentialId: string): void;
};

/** Factory: returns an in-memory PasskeyAdapter on the current (userHandle-based) seam. Pass a
 *  fixed `seed` when a test needs two independent adapters to reconstruct the identical wallet. */
export function makeFakePasskey(rpId = "qudi.fi", seed?: number): FakePasskey {
  return new FakePasskeyAdapter(rpId, seed);
}

// ---------------------------------------------------------------------------
// makeFakeRpc — minimal RpcClient for leanResolve tests.
// ---------------------------------------------------------------------------

/**
 * Returns a fake RpcClient for leanResolve testing.
 *
 * - `delegated: false` → getCode returns "0x" (undelegated)
 * - `delegated: Address` → getCode returns the EIP-7702 designator for that implementation
 * - `nonce` → getTransactionCount return value (accepts number or bigint)
 * - `implDeployed` (default true) → whether a canonicalImplementation lookup (leanResolve's
 *   deploy-existence guard) sees non-empty code. Set to false to simulate an undeployed
 *   canonical implementation. leanResolve/isDelegated only ever call getCode with the account
 *   address first, then (only when undelegated) the canonicalImplementation address — so the
 *   first call always answers the account's delegation state, and any subsequent call answers
 *   the implementation's deploy state.
 * - simulateCalls returns one SimCallResult per call with gasUsed = 50_000n
 * - readContract returns a synthetic Chainlink latestRoundData tuple (answer = 200_000_000_000n ~= 2000 USD, 8 dec)
 */
export function makeFakeRpc(opts: {
  delegated: Address | false;
  nonce: number | bigint;
  implDeployed?: boolean;
  /** Native balance the enrolment affordability gate sees. Defaults to a funded wallet. */
  balance?: bigint;
}): RpcClient {
  const txNonce = Number(opts.nonce);
  const accountCode: Hex =
    opts.delegated === false
      ? "0x"
      : (`0xef0100${(opts.delegated as string).slice(2)}` as Hex);
  const implDeployed = opts.implDeployed ?? true;
  const DEPLOYED_CODE: Hex = "0x6001600101"; // arbitrary non-empty bytecode, simulates a deployed contract
  let getCodeCalls = 0;

  return {
    chainId: async () => 10,
    getCode: async (_address: Address): Promise<Hex> => {
      getCodeCalls += 1;
      if (getCodeCalls === 1) return accountCode;
      return implDeployed ? DEPLOYED_CODE : "0x";
    },
    getTransactionCount: async (_address: Address): Promise<number> => txNonce,
    simulateCalls: async (args: SimulateArgs): Promise<SimCallResult[]> =>
      args.calls.map(() => ({ status: "success" as const, gasUsed: 50_000n, returnData: "0x" as Hex })),
    call: async (_args) => "0x" as Hex,
    estimateGas: async (_args) => 21_000n,
    getGasPrice: async () => 1_000_000_000n, // 1 gwei (= base + suggested tip)
    getBaseFeePerGas: async () => 400_000_000n, // 0.4 gwei — NOT equal to gasPrice, on purpose
    // 0.6 gwei — the chain's SUGGESTED tip, and the third distinct number. Equal to neither of the
    // others: a fake where the tip IS gasPrice cannot see a submitter bidding the base fee twice.
    getMaxPriorityFeePerGas: async () => 600_000_000n,
    // A funded wallet by default: the enrolment affordability gate reads this. Tests that want to
    // exercise the "top up first" path override it with a poor balance.
    getBalance: async () => opts.balance ?? 10n ** 18n, // 1 native unit
    readContract: async <T>(args: ReadArgs): Promise<T> => {
      // The 4337 sponsored path reads the EntryPoint's 2D nonce (getNonce(sender, key)); everything else
      // here is the Chainlink oracle's latestRoundData.
      if ((args as { functionName?: string }).functionName === "getNonce") return BigInt(txNonce) as unknown as T;
      // Chainlink latestRoundData: [roundId, answer, startedAt, updatedAt, answeredInRound]
      // answer at [1] — must be > 0n; 200_000_000_000n ≈ 2000 USD with 8 decimals
      return [0n, 200_000_000_000n, 0n, 0n, 0n] as unknown as T;
    },
    sendRawTransaction: async (_serialized: Hex): Promise<Hex> => "0x" as Hex,
    getTransactionReceipt: async (_hash: Hex) => null,
  };
}

// ---------------------------------------------------------------------------
// FakeChannel — implements SigningChannel for shared-origin connection tests.
// ---------------------------------------------------------------------------

/** Encodes a plain ASCII string to base64url (no padding). */
function base64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Encodes raw bytes to base64url (no padding). */
function bytesToBase64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return base64url(s);
}

// A lazily-created ES256 signer + JWKS, so the fake /token issues id_tokens the client will verify
// against the fake /jwks (mirrors the origin's real ES256 signing). Cached across calls.
let _testSigner: { jwks: { keys: JsonWebKey[] }; sign(p: Record<string, unknown>): Promise<string> } | null = null;
async function getTestSigner() {
  if (_testSigner) return _testSigner;
  const { privateKey, publicKey } = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", publicKey)) as JsonWebKey & { kid?: string };
  jwk.kid = "test-kid";
  _testSigner = {
    jwks: { keys: [jwk] },
    async sign(payload) {
      const enc = new TextEncoder();
      const header = base64url(JSON.stringify({ alg: "ES256", kid: "test-kid" }));
      const body = base64url(JSON.stringify(payload));
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(`${header}.${body}`)));
      return `${header}.${body}.${bytesToBase64url(sig)}`;
    },
  };
  return _testSigner;
}

export type FakeChannel = SigningChannel;

/**
 * makeFakeChannel builds a FakeChannel that:
 * - For "authorize": returns `{ kind:"authorize", account }` — what the popup postMessages back.
 * - For "sign": returns `{ kind:"sign", result:{ signature:"0xdeadbeef..." } }`.
 *
 * #8 removed `fakeTokenFetch`. It stubbed `/token` + `/jwks` with a real ES256-signed id_token so
 * the OIDC code exchange would verify — there is no code, no token, and no endpoint to stub.
 */
export function makeFakeChannel(opts: { address: string; subname?: string; solanaAddress?: string }): FakeChannel {
  const { address, solanaAddress } = opts;

  const channel: FakeChannel = {
    async open(req: ChannelRequest) {
      if (req.kind === "authorize") {
        // #8: the popup returns the ACCOUNT it just read from the wallet. No code, no state, no
        // token to exchange.
        return {
          kind: "authorize" as const,
          account: {
            evmAddress: address as `0x${string}`,
            ...(solanaAddress ? { solanaAddress } : {}),
            credentialId: "cred-1",
          },
        };
      }
      if (req.kind === "sign") {
        return { kind: "sign" as const, result: { signature: "0xdeadbeef" as Hex } };
      }
      throw new Error(`FakeChannel: unexpected kind "${(req as { kind: string }).kind}"`);
    },
  };

  return channel;
}



/**
 * The three access-slot-write phases, for AccessCtx doubles. Spread it into any fake: `{ ...ACCESS_SLOT_WRITER }`.
 *
 * An access-slot write is now ONE passkey gesture — resolve with no key (prepare), seal AND sign inside a
 * single scope (sign), broadcast after (broadcast). `broadcastWrite` forwards to the fake's OWN
 * `submit` (it is called as `ctx.broadcastWrite(...)`, so `this` is the fake), which means every
 * assertion written against `submit` keeps working AND still sees the real sealed ciphertext.
 */
export const ACCESS_SLOT_WRITER = {
  prepareWrite: async (_probe: Call[], chainId: number) => ({ chainId }),
  signWrite: async (_prepared: unknown, calls: Call[]) => ({ calls }),
  broadcastWrite(
    this: { submit: (calls: Call[], o: { chainId: number }) => Promise<{ id: string }> },
    prepared: unknown,
    signed: unknown,
  ): Promise<{ id: string }> {
    return this.submit((signed as { calls: Call[] }).calls, { chainId: (prepared as { chainId: number }).chainId });
  },
};
