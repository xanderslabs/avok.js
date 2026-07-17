import { describe, it, expect, vi, type Mock } from "vitest";
import type { Address, Hex, TransactionSerializable } from "viem";
import { createAvokClient } from "../src/client/client.js";
import { createEvmNamespace } from "../src/client/evm.js";
import { createOwnOriginConnection } from "../src/own-origin/connection.js";
import { getChainProfile, type FetchLike } from "@avokjs/txengine";
import { deriveSlotId } from "@avokjs/wallet-core";
import type { Connection, SelfCustodyConnection } from "../src/types.js";
import { makeFakePasskey, makeFakeRpc } from "./fakes.js";


// chainId 10 (Optimism) is in the registry; first token is a real, priceable fee token.
const CHAIN = getChainProfile(10)!;
const FEE_TOKEN = Object.values(CHAIN.tokens)[0]!.address;
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const FRONTER = "0x3333333333333333333333333333333333333333" as const;
const TO = "0x2222222222222222222222222222222222222222" as const;

// Non-zero canonical implementation for tests that exercise the undelegated authorization path.
// Chain 10's canonicalImplementation is the PENDING zero-address placeholder; using it in
// undelegated tests would trigger the fail-loud zero-address guard in leanResolve.
const NON_ZERO_IMPL = "0x1234567890123456789012345678901234567890" as const satisfies Address;
const TEST_CHAIN = { ...CHAIN, canonicalImplementation: NON_ZERO_IMPL };

/** Minimal Connection double exposing only what simulate/send touch. */
function makeFakeConnection(overrides: Partial<Connection> & { address?: Address } = {}): Connection {
  const address = overrides.address ?? WALLET;
  const conn = {
    account: () => ({ evm: { address }, solana: { address: "11111111111111111111111111111111" } }),
    status: () => true,
    signTypedData: overrides.signTypedData ?? vi.fn(async () => "0xsig" as Hex),
    signAuthorization:
      overrides.signAuthorization ??
      vi.fn(async (a) => ({ ...a, r: "0xr" as Hex, s: "0xs" as Hex, yParity: 0 })),
    signTransaction: overrides.signTransaction ?? vi.fn(async () => "0xserialized" as Hex),
    signMessage: vi.fn(),
    signSiwe: vi.fn(),
    create: vi.fn(),
    continue: vi.fn(),
    export: vi.fn(),
    logout: vi.fn(),
    canExport: false,
    ...overrides,
  } as unknown as Connection;

  // ONE gesture per user action. The composite verbs are what the client calls now; each is a SINGLE
  // passkey gesture (own-origin) or a SINGLE popup (shared-origin). They delegate to the same spies so
  // existing assertions still see signAuthorization/signTransaction/signTypedData, and we can count
  // how many gestures a send actually costs — which is the whole point, since the bug was never
  // visible in the result: the transaction was correct, the user was just asked twice.
  const c = conn as unknown as Record<string, unknown>;
  // Mirrors the REAL signer: it signs the authorization and EMBEDS it in the transaction. That
  // embedding is the whole reason this is a composite op rather than two requests — so the fake must
  // do it too, or the tests would pass against a signer that does not exist.
  c.signSend = vi.fn(async (args: { tx: Record<string, unknown>; authorization?: unknown }) => {
    if (!args.authorization) return (conn.signTransaction as (t: unknown) => Promise<Hex>)(args.tx);
    const signedAuth = await (conn.signAuthorization as (a: unknown) => Promise<unknown>)(args.authorization);
    return (conn.signTransaction as (t: unknown) => Promise<Hex>)({
      ...args.tx,
      type: "eip7702",
      authorizationList: [signedAuth],
    });
  });
  c.signFronted = vi.fn(async (args: { typedData: unknown; authorization?: unknown }) => {
    const authorization = args.authorization
      ? await (conn.signAuthorization as (a: unknown) => Promise<unknown>)(args.authorization)
      : undefined;
    const signature = await (conn.signTypedData as (t: unknown) => Promise<Hex>)(args.typedData);
    return { signature, ...(authorization ? { authorization } : {}) };
  });
  // The 4337 fronted composite: one gesture yields the raw userOpHash signature and, when undelegated,
  // the 7702 authorization. Delegates to signAuthorization so the existing spy counts the gestures.
  c.signUserOp = vi.fn(async (args: { userOp: unknown; chainId: number; authorization?: unknown }) => {
    const authorization = args.authorization
      ? await (conn.signAuthorization as (a: unknown) => Promise<unknown>)(args.authorization)
      : undefined;
    return { signature: "0xu5e40p" as Hex, ...(authorization ? { authorization } : {}) };
  });
  return conn;
}

/** FetchLike double: GET /config → one-chain config; POST /relay → { id }. */
function makeFakeRelayFetch(id = "r1"): FetchLike {
  return async (url, _init) => {
    if (url.endsWith("/config")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          chains: {
            10: { fronter: FRONTER, supportedTokens: [FEE_TOKEN], bufferBps: 1500, marginBps: 500 },
          },
        }),
      };
    }
    if (url.endsWith("/relay")) {
      return { ok: true, status: 200, json: async () => ({ id }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

describe("createAvokClient — ceremony delegation", () => {
  it("delegates create/account/status to the connection", async () => {
    const connection = createOwnOriginConnection({ rpId: "qudi.fi", passkey: makeFakePasskey() });
    const client = createAvokClient({ connection });
    const acct = await client.create();
    expect(client.account()?.evm.address).toBe(acct.evm.address);
    expect(client.account()?.solana.address).toBe(acct.solana.address);
    expect(client.status()).toBe(true);
  });

  it("logout clears account", async () => {
    const connection = createOwnOriginConnection({ rpId: "qudi.fi", passkey: makeFakePasskey() });
    const client = createAvokClient({ connection });
    await client.create();
    client.logout();
    expect(client.account()).toBeNull();
    expect(client.status()).toBe(false);
  });
});

describe("createAvokClient — capability gating", () => {
  it("export delegates when canExport is true", async () => {
    const connection = createOwnOriginConnection({ rpId: "qudi.fi", passkey: makeFakePasskey() });
    const client = createAvokClient({ connection });
    await client.create();
    expect(await client.exportEvmKey()).toMatch(/^0x/);
    expect(await client.exportSolanaKey()).toMatch(/^0x/);
  });

  // Self-custody guard path still lives in client.ts: export() throws when the (self-custody)
  // connection reports it cannot export. A minimal SelfCustodyConnection fake exercises the throw
  // branch without reaching sc.export(). (Import is gone: a PRF-derived wallet has no key to import.)
  function makeUncapableSelf(overrides: Partial<SelfCustodyConnection>): SelfCustodyConnection {
    return {
      custody: "self",
      canExport: true,
      account: () => null,
      status: () => false,
      export: async () => ({ evm: "0xkey" as Hex, solana: "0xsol" as Hex }),
      pairing: { holder: {}, enroller: {} },
      ...overrides,
    } as unknown as SelfCustodyConnection;
  }

  it("export throws when the self-custody connection cannot export", async () => {
    const client = createAvokClient({ connection: makeUncapableSelf({ canExport: false }) });
    await expect(client.exportEvmKey()).rejects.toThrow(/cannot export/i);
  });
});

/** Fake 7677 paymaster: records params, returns a stub then final sponsorship. */
function makeFakePaymaster(pm = "0x4444444444444444444444444444444444444444" as Address) {
  return {
    getPaymasterStubData: vi.fn(async () => ({
      paymaster: pm,
      paymasterData: "0xstub" as Hex,
      paymasterVerificationGasLimit: 20_000n,
      paymasterPostOpGasLimit: 10_000n,
    })),
    getPaymasterData: vi.fn(async () => ({ paymaster: pm, paymasterData: "0xfinal" as Hex })),
  };
}

/** Fake bundler: estimates gas, echoes a userOpHash on submit, and tracks receipts. */
function makeFakeBundler(userOpHash = "0xuserophash" as Hex) {
  return {
    estimateUserOperationGas: vi.fn(async () => ({
      callGasLimit: 100_000n,
      verificationGasLimit: 120_000n,
      preVerificationGas: 50_000n,
      paymasterVerificationGasLimit: 20_000n,
      paymasterPostOpGasLimit: 10_000n,
    })),
    sendUserOperation: vi.fn(async (_op: unknown) => userOpHash),
    getUserOperationReceipt: vi.fn(async () => null),
  };
}

describe("createAvokClient — fronted send via 4337 UserOp (D3)", () => {
  it("builds a UserOp, runs the 7677 handshake, submits to the bundler, and returns rail=fronted with the userOpHash", async () => {
    const connection = makeFakeConnection() as Connection & { signUserOp: Mock };
    const bundler = makeFakeBundler("0xabc123hash");
    const paymaster = makeFakePaymaster();
    const rpc = makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 3 });
    const evm = createEvmNamespace({
      connection,
      paymasterUrl: "https://pm.test",
      bundlerUrl: "https://bundler.test",
      deps: { rpc, chain: TEST_CHAIN, bundler, paymaster },
    });

    const receipt = await evm.send([{ to: TO, value: 0n, data: "0x" }], { chainId: 10, feeToken: FEE_TOKEN });

    // The 7677 handshake ran: stub → estimate → final data.
    expect(paymaster.getPaymasterStubData).toHaveBeenCalledOnce();
    expect(bundler.estimateUserOperationGas).toHaveBeenCalledOnce();
    expect(paymaster.getPaymasterData).toHaveBeenCalledOnce();
    // The connection signed the UserOp once (one gesture); the bundler received the signed op.
    expect(connection.signUserOp).toHaveBeenCalledOnce();
    expect(bundler.sendUserOperation).toHaveBeenCalledOnce();
    const submitted = bundler.sendUserOperation.mock.calls[0]![0] as { signature: Hex; paymaster?: Address; paymasterData?: Hex };
    expect(submitted.signature).toBe("0xu5e40p"); // the connection's signature, not the stub
    expect(submitted.paymasterData).toBe("0xfinal"); // the FINAL sponsorship, not the stub
    // The receipt id is the bundler's userOpHash — an intent id, not a tx hash.
    expect(receipt.rail).toBe("fronted");
    expect(receipt.status).toBe("pending");
    expect(receipt.id).toBe("0xabc123hash");
  });

  it("attaches the 7702 authorization for an undelegated wallet (one gesture)", async () => {
    const connection = makeFakeConnection() as Connection & { signUserOp: Mock; signAuthorization: Mock };
    const bundler = makeFakeBundler();
    const paymaster = makeFakePaymaster();
    const rpc = makeFakeRpc({ delegated: false, nonce: 5 });
    const evm = createEvmNamespace({
      connection,
      paymasterUrl: "https://pm.test",
      bundlerUrl: "https://bundler.test",
      deps: { rpc, chain: TEST_CHAIN, bundler, paymaster },
    });

    await evm.send([{ to: TO, value: 0n, data: "0x" }], { chainId: 10, feeToken: FEE_TOKEN });

    // ONE gesture: signUserOp carried BOTH the userOpHash signature and the 7702 authorization.
    expect(connection.signUserOp).toHaveBeenCalledOnce();
    const arg = connection.signUserOp.mock.calls[0]![0] as { authorization?: { address: Address } };
    expect(arg.authorization?.address).toBe(NON_ZERO_IMPL); // delegates to the canonical implementation
    const submitted = bundler.sendUserOperation.mock.calls[0]![0] as { authorization?: unknown };
    expect(submitted.authorization).toBeDefined(); // the signed 7702 tuple rides on the submitted UserOp
  });

  it("falls back to self-pay on a chain with no bundler/paymaster configured", async () => {
    const connection = makeFakeConnection() as Connection & { signSend: Mock; signUserOp: Mock };
    const rpc = makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 2 });
    rpc.sendRawTransaction = vi.fn(async () => "0xselfpaytx" as Hex);
    // feeToken requested, but no bundlerUrl/paymasterUrl → the send must self-pay, not throw.
    const evm = createEvmNamespace({ connection, deps: { rpc, chain: TEST_CHAIN } });

    const receipt = await evm.send([{ to: TO, value: 0n, data: "0x" }], { chainId: 10, feeToken: FEE_TOKEN });

    expect(receipt.rail).toBe("self-pay");
    expect(connection.signUserOp).not.toHaveBeenCalled();
    expect(connection.signSend).toHaveBeenCalledOnce();
  });

  it("fronted simulate returns a bounded FeeBreakdown (total gas limits × maxFeePerGas)", async () => {
    const connection = makeFakeConnection();
    const bundler = makeFakeBundler();
    const paymaster = makeFakePaymaster();
    const rpc = makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 4 });
    const evm = createEvmNamespace({
      connection,
      paymasterUrl: "https://pm.test",
      bundlerUrl: "https://bundler.test",
      deps: { rpc, chain: TEST_CHAIN, bundler, paymaster },
    });

    const sim = await evm.simulate([{ to: TO, value: 0n, data: "0x" }], { chainId: 10, feeToken: FEE_TOKEN });

    expect(sim.fee).toBeDefined();
    expect(sim.fee!.feeToken.toLowerCase()).toBe(FEE_TOKEN.toLowerCase());
    // Bounded gas = callGasLimit + verificationGasLimit + preVerificationGas + paymaster limits.
    expect(sim.fee!.gasUnits).toBe(100_000n + 120_000n + 50_000n + 20_000n + 10_000n);
    // The committed ceiling — maxFeePerGas, not an effective price.
    expect(sim.fee!.gasPrice).toBeGreaterThan(0n);
    // Post-oracle: no USD conversion — amount is the raw gas ceiling (gasUnits × maxFeePerGas), in
    // native units, and `feeToken` merely labels the token the paymaster sponsors in.
    expect(sim.fee!.amount).toBe(sim.fee!.gasUnits * sim.fee!.gasPrice);
  });

  it("send reuses the UserOp priced by a prior simulate — sign-what-you-saw (no second 7677 handshake)", async () => {
    const connection = makeFakeConnection();
    const bundler = makeFakeBundler("0xfeehash");
    const paymaster = makeFakePaymaster();
    const rpc = makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 4 });
    const evm = createEvmNamespace({
      connection,
      paymasterUrl: "https://pm.test",
      bundlerUrl: "https://bundler.test",
      deps: { rpc, chain: TEST_CHAIN, bundler, paymaster },
    });

    const sim = await evm.simulate([{ to: TO, value: 0n, data: "0x" }], { chainId: 10, feeToken: FEE_TOKEN });
    const receipt = await evm.send(sim);

    // The 7677 handshake + gas estimate ran ONCE (during simulate); send did not re-run them — it
    // signed the exact op simulate priced.
    expect(paymaster.getPaymasterData).toHaveBeenCalledOnce();
    expect(bundler.estimateUserOperationGas).toHaveBeenCalledOnce();
    expect(bundler.sendUserOperation).toHaveBeenCalledOnce();
    expect(receipt.rail).toBe("fronted");
    expect(receipt.id).toBe("0xfeehash");
  });
});

describe("createAvokClient — self-pay send (D3)", () => {
  // ── ONE USER ACTION = ONE PASSKEY GESTURE ──────────────────────────────────────────────────────
  // An undelegated wallet's send needs TWO signatures (the 7702 authorization and the transaction).
  // This client used to produce them by calling the connection's individual key-bound verbs, so a
  // single "Send" opened two key scopes and asked the user for a fingerprint TWICE. Beyond the
  // annoyance, that teaches people to approve prompts reflexively — the exact habit a malicious
  // second prompt exploits. These two tests fail the moment the scope count regresses.

  it("undelegated send: TWO signatures, but exactly ONE gesture (one biometric prompt / one popup)", async () => {
    const connection = makeFakeConnection() as Connection & { signSend: Mock };
    const rpc = makeFakeRpc({ delegated: false, nonce: 5 });
    rpc.sendRawTransaction = vi.fn(async (_s: Hex) => "0xtxhash" as Hex);
    const evm = createEvmNamespace({ connection, deps: { rpc, chain: TEST_CHAIN } });

    await evm.send([{ to: TO, value: 0n, data: "0x" }], { chainId: 10 });

    expect(connection.signSend).toHaveBeenCalledTimes(1); // ← ONE gesture, not two
    expect(connection.signAuthorization).toHaveBeenCalledOnce(); // ← both signatures…
    expect(connection.signTransaction).toHaveBeenCalledOnce(); // ← …inside that one gesture
  });

  // ── THE GAS LIMIT IS A DISCLOSURE, NOT JUST A SAFETY MARGIN ────────────────────────────────────
  // `gas × maxFeePerGas` is the MOST a self-pay signature can cost, and on the shared-origin consent
  // screen it is the ONLY fee fact derivable from the signed bytes (self-pay commits no fee call, and
  // a stateless origin cannot verify an app-supplied estimate). A flat 1_000_000-gas cap — ~20× a
  // token transfer — made that disclosure meaningless: "at most 0.09 USDC" for a 0.0046 transaction.
  it("caps gas from the batch's own estimate, so the authorized maximum is meaningful", async () => {
    const connection = makeFakeConnection() as Connection & { signSend: Mock };
    const rpc = makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 5 });
    rpc.sendRawTransaction = vi.fn(async (_s: Hex) => "0xtxhash" as Hex);
    const evm = createEvmNamespace({ connection, deps: { rpc, chain: TEST_CHAIN } });

    const sim = await evm.simulate([{ to: TO, value: 0n, data: "0x" }], { chainId: 10 });
    await evm.send(sim, { chainId: 10 });

    const gasUnits = sim.batch.nativeFee!.gasUnits;
    const tx = connection.signSend.mock.calls[0]![0].tx as { gas: bigint };
    expect(tx.gas).toBe(gasUnits * 2n);
    expect(tx.gas).toBeLessThan(1_000_000n); // ← the old flat cap
    // Headroom, though: undershooting burns the user's fee on an out-of-gas revert.
    expect(tx.gas).toBeGreaterThan(gasUnits);
  });

  it("delegated send: one signature, still exactly ONE gesture", async () => {
    const connection = makeFakeConnection() as Connection & { signSend: Mock };
    const rpc = makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 5 });
    rpc.sendRawTransaction = vi.fn(async (_s: Hex) => "0xtxhash" as Hex);
    const evm = createEvmNamespace({ connection, deps: { rpc, chain: TEST_CHAIN } });

    await evm.send([{ to: TO, value: 0n, data: "0x" }], { chainId: 10 });

    expect(connection.signSend).toHaveBeenCalledTimes(1);
    expect(connection.signAuthorization).not.toHaveBeenCalled();
    expect(connection.signTransaction).toHaveBeenCalledOnce();
  });

  it("undelegated: signs authorization over txNonce+1 and broadcasts the serialized tx", async () => {
    const signAuthorization = vi.fn(async (a: { chainId: number; address: Address; nonce: number }) => ({
      ...a,
      r: "0xr" as Hex,
      s: "0xs" as Hex,
      yParity: 0,
    }));
    const signTransaction = vi.fn<(tx: TransactionSerializable) => Promise<Hex>>(async () => "0xserialized" as Hex);
    const connection = makeFakeConnection({ signAuthorization, signTransaction });
    const rpc = makeFakeRpc({ delegated: false, nonce: 5 });
    const sendRaw = vi.fn(async (_s: Hex) => "0xtxhash" as Hex);
    rpc.sendRawTransaction = sendRaw;
    const evm = createEvmNamespace({ connection, deps: { rpc, chain: TEST_CHAIN } });

    const receipt = await evm.send([{ to: TO, value: 0n, data: "0x" }], { chainId: 10 });

    // Self-fronting invariant: authorization nonce = txNonce + 1 (5 → 6).
    expect(signAuthorization).toHaveBeenCalledOnce();
    expect(signAuthorization.mock.calls[0]![0].nonce).toBe(6);
    // The signed tx carries the authorizationList (eip7702) and is broadcast as-is.
    const txArg = signTransaction.mock.calls[0]![0] as TransactionSerializable & {
      authorizationList?: unknown[];
    };
    expect(txArg.type).toBe("eip7702");
    expect(txArg.authorizationList).toHaveLength(1);
    expect(txArg.nonce).toBe(5);
    expect(sendRaw).toHaveBeenCalledWith("0xserialized");
    expect(receipt.rail).toBe("self-pay");
    expect(receipt.status).toBe("submitted");
    expect(receipt.txHash).toBe("0xtxhash");
    expect(receipt.id).toBe("0xtxhash");
  });

  it("already delegated: builds an eip1559 tx with no authorizationList", async () => {
    const signAuthorization = vi.fn();
    const signTransaction = vi.fn<(tx: TransactionSerializable) => Promise<Hex>>(async () => "0xserialized" as Hex);
    const connection = makeFakeConnection({ signAuthorization, signTransaction });
    // rpc returns wallet delegated to NON_ZERO_IMPL; TEST_CHAIN.canonicalImplementation matches.
    const rpc = makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 2 });
    const sendRaw = vi.fn(async (_s: Hex) => "0xtxhash" as Hex);
    rpc.sendRawTransaction = sendRaw;
    const evm = createEvmNamespace({ connection, deps: { rpc, chain: TEST_CHAIN } });

    await evm.send([{ to: TO, value: 0n, data: "0x" }], { chainId: 10 });

    expect(signAuthorization).not.toHaveBeenCalled();
    const txArg = signTransaction.mock.calls[0]![0] as TransactionSerializable & {
      authorizationList?: unknown[];
    };
    expect(txArg.type).toBe("eip1559");
    expect(txArg.authorizationList).toBeUndefined();
  });
});

describe("createAvokClient — simulate (D3)", () => {
  it("self-pay: returns a SimulationResult without a gesture", async () => {
    const signTransaction = vi.fn();
    const connection = makeFakeConnection({ signTransaction });
    const rpc = makeFakeRpc({ delegated: false, nonce: 0 });
    const evm = createEvmNamespace({ connection, deps: { rpc, chain: TEST_CHAIN } });
    const sim = await evm.simulate([{ to: TO, value: 0n, data: "0x" }], { chainId: 10 });
    expect(sim.batch.rail).toBe("self-pay");
    expect(sim.success).toBe(true);
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("send reuses a prior SimulationResult's batch (sign-what-you-saw)", async () => {
    const signTransaction = vi.fn(async () => "0xserialized" as Hex);
    const connection = makeFakeConnection({ signTransaction });
    const rpc = makeFakeRpc({ delegated: false, nonce: 4 });
    const getCodeSpy = vi.spyOn(rpc, "getCode");
    rpc.sendRawTransaction = vi.fn(async () => "0xtxhash" as Hex);
    const evm = createEvmNamespace({ connection, deps: { rpc, chain: TEST_CHAIN } });
    const sim = await evm.simulate([{ to: TO, value: 0n, data: "0x" }], { chainId: 10 });
    // Record how many times getCode was called during simulate (the resolve phase).
    const callCountAfterSim = getCodeSpy.mock.calls.length;
    expect(callCountAfterSim).toBeGreaterThan(0); // sanity: resolve DID call getCode
    const receipt = await evm.send(sim);
    // send with a prior SimulationResult must NOT re-resolve — no additional getCode calls.
    expect(getCodeSpy.mock.calls.length).toBe(callCountAfterSim);
    expect(receipt.rail).toBe("self-pay");
  });
});

describe("createAvokClient — isActivated (injected rpc)", () => {
  it("returns false when getCode returns 0x", async () => {
    const passkey = makeFakePasskey();
    const connection = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    await connection.create();
    const fakeRpc = makeFakeRpc({ delegated: false, nonce: 0 });
    const client = createAvokClient({ connection, deps: { rpc: fakeRpc } });
    expect(await client.isActivated(10)).toBe(false);
  });

  it("returns true when code matches canonical implementation", async () => {
    const passkey = makeFakePasskey();
    const connection = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    await connection.create();
    // Derive IMPL from the actual chain profile so the test stays correct when the registry is updated.
    const IMPL = CHAIN.canonicalImplementation;
    const fakeRpc = makeFakeRpc({ delegated: IMPL, nonce: 0 });
    const client = createAvokClient({ connection, deps: { rpc: fakeRpc } });
    expect(await client.isActivated(10)).toBe(true);
  });

  it("returns false when no account is active", async () => {
    const connection = createOwnOriginConnection({ rpId: "qudi.fi", passkey: makeFakePasskey() });
    const fakeRpc = makeFakeRpc({ delegated: false, nonce: 0 });
    const client = createAvokClient({ connection, deps: { rpc: fakeRpc } });
    expect(await client.isActivated(10)).toBe(false);
  });

  it("throws when chainId is omitted (no silent default)", async () => {
    const connection = createOwnOriginConnection({ rpId: "qudi.fi", passkey: makeFakePasskey() });
    const client = createAvokClient({ connection });
    // chainId is a required param now; bypass the types to assert the runtime fail-loud guard.
    const c = client as { isActivated(id?: number): Promise<boolean> };
    await expect(c.isActivated()).rejects.toThrow(/chainId is required/i);
  });

  it("accepts explicit chainId override", async () => {
    const passkey = makeFakePasskey();
    const connection = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    await connection.create();
    const fakeRpc = makeFakeRpc({ delegated: false, nonce: 0 });
    // No defaultChainId, but pass chainId 10 explicitly
    const client = createAvokClient({ connection, deps: { rpc: fakeRpc } });
    expect(await client.isActivated(10)).toBe(false);
  });
});

describe("createAvokClient — defaultDeadlineSeconds config", () => {
  it("custom defaultDeadlineSeconds flows into the resolved batch deadline", async () => {
    const connection = makeFakeConnection({});
    const rpc = makeFakeRpc({ delegated: false, nonce: 0 });
    const evm = createEvmNamespace({
      connection,
      defaultDeadlineSeconds: 7200,
      deps: { rpc, chain: TEST_CHAIN },
    });
    const now = BigInt(Math.floor(Date.now() / 1000));
    const sim = await evm.simulate([{ to: TO, value: 0n, data: "0x" }], { chainId: 10 });
    // deadline should be approximately now + 7200 (allow 5s tolerance for test timing)
    expect(sim.batch.deadline).toBeGreaterThanOrEqual(now + 7195n);
    expect(sim.batch.deadline).toBeLessThanOrEqual(now + 7205n);
  });
});

describe("createAvokClient — enrollAccessSlot (enrol secondary + on-chain write)", () => {
  // Ported from the deleted client-access-slot.test.ts: the on-chain ciphertext write and its idempotency
  // now live on enrollAccessSlot, since enrolment and the write are one atomic, funded call.
  function directClient(vaultReader: { getAccessSlot: () => Promise<Uint8Array | null> }) {
    const passkey = makeFakePasskey("localhost");
    const connection = createOwnOriginConnection({ rpId: "localhost", passkey, anchorChainId: "eip155:10" });
    const client = createAvokClient({
      connection,
      deps: { rpc: makeFakeRpc({ delegated: false, nonce: 0 }), chain: TEST_CHAIN, vaultReader },
    });
    return { passkey, client };
  }

  it("enrols a secondary, submits the write, and the returned passkeyCount reflects the new count", async () => {
    const { passkey, client } = directClient({ getAccessSlot: async () => null }); // empty vault → real submit
    await client.create();

    const r = await client.enrollAccessSlot();
    expect(r.passkeyCount).toBe(2);
    // The slot id is the NEW (secondary) credential's, and a real write occurred (vault was empty).
    expect(r.slotId).toBe(deriveSlotId(client.account()!.evm.address, passkey.allCredentialIds()[1]));
    expect(r.txId).not.toBe("noop");
  });

  it("is idempotent: when the new slot is already stored, it writes nothing (txId 'noop')", async () => {
    // slot present: getAccessSlot returns ciphertext (non-null) → hasSlot true → no submit.
    const { passkey, client } = directClient({ getAccessSlot: async () => new Uint8Array([1]) });
    await client.create();

    const r = await client.enrollAccessSlot();
    expect(r.txId).toBe("noop");
    expect(r.slotId).toBe(deriveSlotId(client.account()!.evm.address, passkey.allCredentialIds()[1]));
    expect(r.passkeyCount).toBe(2); // enrolment still happened locally
  });
});

describe("enrolment affordability gate", () => {
  it("blocks an unfunded wallet BEFORE any passkey is minted, and says what to do", async () => {
    const passkey = makeFakePasskey("localhost");
    const connection = createOwnOriginConnection({ rpId: "localhost", passkey, anchorChainId: "eip155:10" });
    const client = createAvokClient({
      connection,
      deps: {
        rpc: makeFakeRpc({ delegated: false, nonce: 0, balance: 0n }), // an empty wallet
        chain: TEST_CHAIN,
        vaultReader: { getAccessSlot: async () => null }, // the chain answers; it just holds no access slot
      },
    });
    await client.create();
    const before = passkey.allCredentialIds().length;

    const err = (await client.enrollAccessSlot().catch((e) => e)) as Error;
    expect(err.name).toBe("EnrolmentUnaffordableError");
    expect(err.message).toMatch(/not enough funds/i);
    expect(err.message).toMatch(/top the wallet up/i);

    // THE POINT: nothing was created. No mystery passkey in the picker, no orphan to repair.
    expect(passkey.allCredentialIds()).toHaveLength(before);
  });

  it("lets a funded wallet through", async () => {
    const passkey = makeFakePasskey("localhost");
    const connection = createOwnOriginConnection({ rpId: "localhost", passkey, anchorChainId: "eip155:10" });
    const client = createAvokClient({
      connection,
      deps: {
        rpc: makeFakeRpc({ delegated: false, nonce: 0 }),
        chain: TEST_CHAIN,
        vaultReader: { getAccessSlot: async () => null },
        fetch: makeFakeRelayFetch(),
      },
    });
    await client.create();
    await expect(client.enrollAccessSlot()).resolves.toBeDefined();
  });
});
