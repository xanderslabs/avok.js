import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData, hexToBytes, parseTransaction, type Address, type Hex } from "viem";
import { createOwnOriginConnection } from "../src/own-origin/connection.js";
import { createAvokClient } from "../src/client/client.js";
import { makeFakePasskey, makeFakeRpc, ACCESS_SLOT_WRITER } from "./fakes.js";
import { ACCESS_VAULT_ABI } from "@avokjs/wallet-core";
import { AvokWalletImplementationABI } from "@avokjs/contracts";
import { getChainProfile, type Call } from "@avokjs/txengine";
import type { PriceOracle } from "@avokjs/oracle";

// ERC-7821 execute(mode, executionData) wraps abi.encode(Call[]) — the shape the self-pay calldata carries.
const CALLS_PARAM = [
  {
    type: "tuple[]",
    components: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

/**
 * A fake anchor vault that absorbs the on-chain addAccessSlot(slotId, encryptedBlob) write and
 * serves it back through getAccessSlot — exactly the chain's role in a SECONDARY's recovery.
 * Doubles as the `AccessCtx` (submit + hasSlot) a paired device B must use to persist its slot.
 */
function capturingVault() {
  const store = new Map<string, Uint8Array>();
  return {
    submit: async (calls: Call[], _o: { chainId: number }) => {
      for (const c of calls) {
        const decoded = decodeFunctionData({ abi: ACCESS_VAULT_ABI, data: c.data });
        if (decoded.functionName === "addAccessSlot") {
          const [slotId, encryptedBlob] = decoded.args as [Hex, Hex, Hex];
          store.set(slotId.toLowerCase(), hexToBytes(encryptedBlob));
        }
      }
      return { id: "tx-pair" };
    },
    hasSlot: async (slotId: Hex) => store.has(slotId.toLowerCase()),
    assertCanAffordAccessSlot: async () => {},
    ...ACCESS_SLOT_WRITER, ...ACCESS_SLOT_WRITER,
    getAccessSlot: async (_address: Address, slotId: Hex) => store.get(slotId.toLowerCase()) ?? null,
  };
}

describe("Enrolling the user's OWN second device (the same one ceremony)", () => {
  it("gives B its own passkey — and B is NOT logged in by the ceremony, because it received no key", async () => {
    // This is the case the deleted K-shipping flow used to serve. It is now the SAME ceremony that an
    // independent domain uses, because the passkey is the same passkey. What changed: A no longer hands B the
    // wallet key. B derives its own wrapping key, A seals K under it and pays for the write, and B logs
    // in afterwards like any secondary — one extra passkey prompt, and K never touches the wire.
    const vault = capturingVault();
    const passkeyA = makeFakePasskey();
    const A = createOwnOriginConnection({ rpId: "qudi.fi", passkey: passkeyA, anchorVault: vault });
    const accountA = await A.create();

    const passkeyB = makeFakePasskey(); // B: the user's other device, no wallet yet
    const B = createOwnOriginConnection({ rpId: "qudi.fi", passkey: passkeyB, anchorVault: vault });

    const { qr: qr1 } = await B.pairing.enroller.begin();
    const { qr: qr2, sas: sasA } = await A.pairing.holder.authorize({ qr: qr1, ctx: vault });
    const { sas: sasB } = await B.pairing.enroller.receiveAck(qr2);
    expect(sasA).toBe(sasB); // the human confirms this on both screens

    const { qr: qr3 } = await B.pairing.enroller.enroll({ sasConfirmed: true });
    await A.pairing.holder.complete({ qr: qr3, sasConfirmed: true, ctx: vault });

    // B holds no key yet — it was never given one.
    expect(B.status()).toBe(false);

    // It logs in the ordinary way: discover its credential, read its blob, decrypt with its own PRF.
    const accountB = await B.continue();
    expect(accountB.evm.address.toLowerCase()).toBe(accountA.evm.address.toLowerCase());
    expect(accountB.solana.address).toBe(accountA.solana.address); // same K ⇒ same Solana key too
    expect(B.status()).toBe(true);
  });

  it("survives a reload: B's slot is on chain, so a cold continue() recovers the SAME wallet", async () => {
    const vault = capturingVault();
    const passkeyA = makeFakePasskey();
    const A = createOwnOriginConnection({ rpId: "qudi.fi", passkey: passkeyA, anchorVault: vault });
    const accountA = await A.create();

    const passkeyB = makeFakePasskey();
    const B = createOwnOriginConnection({ rpId: "qudi.fi", passkey: passkeyB, anchorVault: vault });
    const { qr: qr1 } = await B.pairing.enroller.begin();
    const { qr: qr2 } = await A.pairing.holder.authorize({ qr: qr1, ctx: vault });
    await B.pairing.enroller.receiveAck(qr2);
    const { qr: qr3 } = await B.pairing.enroller.enroll({ sasConfirmed: true });
    await A.pairing.holder.complete({ qr: qr3, sasConfirmed: true, ctx: vault });

    // Fresh connection over the SAME authenticator: the WebAuthn credential persists, state does not.
    const Breload = createOwnOriginConnection({ rpId: "qudi.fi", passkey: passkeyB, anchorVault: vault });
    const recovered = await Breload.continue();
    expect(recovered.evm.address.toLowerCase()).toBe(accountA.evm.address.toLowerCase());
    expect(recovered.solana.address).toBe(accountA.solana.address);
  });

  it("rejects verbs with no session", async () => {
    const A = createOwnOriginConnection({ rpId: "qudi.fi", passkey: makeFakePasskey() });
    await A.create();
    await expect(
      A.pairing.holder.complete({ qr: "x", sasConfirmed: true, ctx: capturingVault() }),
    ).rejects.toThrow(/no enrolment session|authorize/i);

    const B = createOwnOriginConnection({ rpId: "qudi.fi", passkey: makeFakePasskey() });
    await expect(B.pairing.enroller.enroll({ sasConfirmed: true })).rejects.toThrow(/no enrolment session|receiveAck/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Facade-level pairing: drive client.pairing.importToDevice.complete() through createAvokClient
// with a REAL createOwnOriginConnection, so the facade's accessCtx() (submit = evm.send,
// hasSlot = vaultReader read) is the ctx that runs — the exact surface apps use, and
// the seam the connection-level tests above never exercise. Nothing is stubbed but
// the RPC/relay transport; the ctx itself is the real one.
// ─────────────────────────────────────────────────────────────────────────────

const fakeOracle: PriceOracle = { read: async () => ({ priceE8: 200_000_000_000n }) };
const CHAIN = getChainProfile(10)!; // Optimism is in the registry with priceable fee tokens
// Non-zero canonical impl so the undelegated authorization path doesn't trip leanResolve's
// zero-address guard (chain 10's registry value is the pending zero placeholder).
const NON_ZERO_IMPL = "0x1234567890123456789012345678901234567890" as const satisfies Address;
const TEST_CHAIN = { ...CHAIN, canonicalImplementation: NON_ZERO_IMPL };

/**
 * A harness that plays the anchor chain for the FACADE path. Access-slot writes are now SELF-PAY
 * (SPEC §5), so the facade signs a self-pay transaction and broadcasts it via `rpc.sendRawTransaction`.
 * We parse the serialized tx, unwrap the wallet's own `execute(MODE_BATCH, Call[])`, decode the
 * addAccessSlot call with ACCESS_VAULT_ABI, land the ciphertext in `store`, and serve it back through
 * `vaultReader` — both the facade's idempotency read (hasSlot) AND the reload connection's anchor vault.
 */
function facadeHarness(opts: { failWrite?: boolean } = {}) {
  const store = new Map<string, Uint8Array>();
  let addAccessSlotSubmitted = 0;
  const capturedCalls: { to: Address; data: Hex }[] = [];

  const rpc = {
    ...makeFakeRpc({ delegated: false, nonce: 0 }),
    sendRawTransaction: async (serialized: Hex): Promise<Hex> => {
      // A failed broadcast lands NOTHING — record only on success, or the harness would assert that a
      // failed write still created an access slot (the orphan bug it exists to catch).
      if (opts.failWrite) throw new Error("self-pay broadcast rejected by the node");
      const tx = parseTransaction(serialized) as { data?: Hex };
      const outer = decodeFunctionData({ abi: AvokWalletImplementationABI, data: tx.data ?? "0x" });
      if (outer.functionName === "execute") {
        const [, executionData] = outer.args as [Hex, Hex];
        const [calls] = decodeAbiParameters(CALLS_PARAM, executionData) as unknown as [
          { to: Address; value: bigint; data: Hex }[],
        ];
        for (const c of calls) {
          capturedCalls.push({ to: c.to, data: c.data });
          try {
            const decoded = decodeFunctionData({ abi: ACCESS_VAULT_ABI, data: c.data });
            if (decoded.functionName === "addAccessSlot") {
              const [slotId, encryptedBlob] = decoded.args as [Hex, Hex, Hex];
              store.set(slotId.toLowerCase(), hexToBytes(encryptedBlob));
              addAccessSlotSubmitted += 1;
            }
          } catch {
            // Not an addAccessSlot call — ignore.
          }
        }
      }
      return "0xselfpaytx";
    },
  };

  // VaultReader: getAccessSlot keyed by slotId (the reload path derives the same slotId from the
  // discovered credential), ignoring address — same shape as the connection-level capturingVault.
  const vaultReader = { getAccessSlot: async (_addr: Address, slotId: Hex) => store.get(slotId.toLowerCase()) ?? null };

  return {
    store,
    rpc,
    vaultReader,
    capturedCalls,
    get addAccessSlotSubmitted() {
      return addAccessSlotSubmitted;
    },
  };
}

/** Build a facade client for the HOLDER over a real own-origin connection. Access-slot writes are
 *  self-pay, so the holder's accessCtx carries the write through `rpc.sendRawTransaction`. */
function facadeClientHolder(passkey: ReturnType<typeof makeFakePasskey>, h: ReturnType<typeof facadeHarness>) {
  const conn = createOwnOriginConnection({ rpId: "localhost", passkey, anchorChainId: "eip155:10" });
  const client = createAvokClient({
    connection: conn,
    deps: { rpc: h.rpc, chain: TEST_CHAIN, oracle: fakeOracle, vaultReader: h.vaultReader },
  });
  return client;
}

/** Run the ceremony between the FACADE holder and a raw enroller device, returning the wrap QR. */
async function handshake(
  clientHolder: ReturnType<typeof facadeClientHolder>,
  B: ReturnType<typeof createOwnOriginConnection>,
) {
  const { qr: qr1 } = await B.pairing.enroller.begin();
  // The FACADE injects the ctx (for the preflight and the write) — the app never assembles one.
  const { qr: qr2, sas: sasA } = await clientHolder.enrollAccessSlot.viaPairing.holder.authorize({ qr: qr1 });
  const { sas: sasB } = await B.pairing.enroller.receiveAck(qr2);
  expect(sasA).toBe(sasB); // the human confirms this
  const { qr: qr3 } = await B.pairing.enroller.enroll({ sasConfirmed: true });
  return qr3;
}

describe("Passkey enrolment — through the client facade (accessCtx)", () => {
  it("the HOLDER's facade submits the addAccessSlot write, and the enrolled device then logs in", async () => {
    // The payment side flipped with the collapse: the enroller has no chain access by design, so the
    // HOLDER's accessCtx (evm.send → self-pay broadcast) is what carries the write. This drives that seam.
    const h = facadeHarness();
    const passkeyHolder = makeFakePasskey("localhost");
    const clientHolder = facadeClientHolder(passkeyHolder, h);
    const accountA = await clientHolder.create();

    const passkeyB = makeFakePasskey("localhost");
    const B = createOwnOriginConnection({
      rpId: "localhost",
      passkey: passkeyB,
      anchorVault: h.vaultReader,
      anchorChainId: "eip155:10",
    });

    const wrapQr = await handshake(clientHolder, B);
    const { txId } = await clientHolder.enrollAccessSlot.viaPairing.holder.complete({ qr: wrapQr, sasConfirmed: true });
    expect(txId).toBe("0xselfpaytx");

    // The write actually went out — decode the captured self-pay batch calls with the ABI.
    expect(h.addAccessSlotSubmitted).toBe(1);
    const decodedNames = h.capturedCalls
      .map((c) => {
        try {
          return decodeFunctionData({ abi: ACCESS_VAULT_ABI, data: c.data }).functionName;
        } catch {
          return null;
        }
      })
      .filter((n): n is NonNullable<typeof n> => n !== null);
    expect(decodedNames).toContain("addAccessSlot");

    // The holder still holds its own wallet; enrolling a passkey does not disturb it.
    expect(clientHolder.status()).toBe(true);

    // And the enrolled device reaches the SAME wallet — byte-identical K ⇒ same EVM and same Solana.
    const recovered = await B.continue();
    expect(recovered.evm.address.toLowerCase()).toBe(accountA.evm.address.toLowerCase());
    expect(recovered.solana.address).toBe(accountA.solana.address);
  });

  it("when the write rejects, complete() FAILS LOUD — no queue, no pending, no promise", async () => {
    // The old behaviour queued the write and called it "pending". That was worse than useless: the
    // queue defaulted to memory, so a reload lost it and the credential was orphaned anyway — it
    // invented a state that lied to the user and solved nothing. The affordability gate now runs BEFORE
    // any credential is minted (see the orphan suite), so a failure HERE is a genuine fault (the chain
    // died mid-ceremony), and the honest thing is to say so.
    const h = facadeHarness({ failWrite: true });
    const passkeyHolder = makeFakePasskey("localhost");
    const clientHolder = facadeClientHolder(passkeyHolder, h);
    await clientHolder.create();

    const passkeyB = makeFakePasskey("localhost");
    const B = createOwnOriginConnection({
      rpId: "localhost",
      passkey: passkeyB,
      anchorVault: h.vaultReader,
      anchorChainId: "eip155:10",
    });

    const wrapQr = await handshake(clientHolder, B);
    await expect(
      clientHolder.enrollAccessSlot.viaPairing.holder.complete({ qr: wrapQr, sasConfirmed: true }),
    ).rejects.toThrow(/broadcast rejected/i);

    expect(h.addAccessSlotSubmitted).toBe(0);
    expect(clientHolder.status()).toBe(true); // the holder's own wallet was never at risk
    expect(B.status()).toBe(false);
  });
});
