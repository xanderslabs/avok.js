import { type Address, type Hex } from "viem";
import { type AccessSlotEntry } from "@avokjs/wallet-core";
import { isDelegatedTo, createViemVaultReader } from "@avokjs/txengine";
import { evmRpcUrl } from "@avokjs/contracts";
import {
  createEvmNamespace,
  resolveChainId,
  resolveRpc,
  requireChain,
  makeViemRpc,
  type PreparedAccessSlotWrite,
  type SignedAccessSlotWrite,
} from "./evm.js";
import type { Call } from "@avokjs/txengine";
import { EnrolmentUnaffordableError } from "../own-origin/connection.js";
import { buildAddAccessSlotCall } from "@avokjs/wallet-core";
import type { AccessCtx, ScopedSigner } from "../types.js";
import { createSolanaNamespace } from "./solana.js";
import type { ClientConfig, Account, CreateOpts, ContinueOpts, Connection, SelfCustodyConnection } from "../types.js";

export type { TxOpts } from "./evm.js";

/**
 * UseOnlyAvokClient is the surface every client exposes — own-origin AND shared-origin. It has
 * transacting + introspection but NO custody-management verbs.
 */
export interface UseOnlyAvokClient {
  /** Log in to an existing account (passkey recovery / resume). Pairs with `create`. */
  login(o?: ContinueOpts): Promise<Account>;
  account(): Account | null;
  status(): boolean;
  logout(): Promise<void> | void;
  /**
   * Subscribe to client state changes. The listener fires after any verb that can change
   * `account()` / `status()` (create / login / logout / enrollAccessSlot). Returns an unsubscribe
   * function. This is the seam the React/RN providers observe — they no longer patch the client
   * object.
   */
  subscribe(listener: () => void): () => void;
  /** Whether the account is EIP-7702-activated (delegated to the wallet impl) on `chainId`. */
  isActivated(chainId: number): Promise<boolean>;
  readonly custody: "self" | "use-only";
}

/**
 * FullAvokClient extends the use-only surface with the custody-management verbs. Only
 * produced when the connection is self-custody (`custody: "self"`).
 */
export interface FullAvokClient extends UseOnlyAvokClient {
  readonly custody: "self";
  create(o?: CreateOpts): Promise<Account>;
  /**
   * Export the ROOT key — the EVM secp256k1 private key. K is the root: the Solana key derives from
   * it one-way (VISION §5), so this single key restores the WHOLE wallet, both chains. Own-origin
   * self-custody only. Raw key, never a phrase (no standard derivation reproduces the HKDF chain).
   */
  exportEvmKey(): Promise<Hex>;
  /** Export the Solana LEAF key (Solana-only; the EVM root already covers it — see `exportEvmKey`). */
  exportSolanaKey(): Promise<Hex>;

  /**
   * Enroll a new passkey as an access slot. Bare call enrols a SECONDARY device and writes its
   * encrypted blob on chain, atomically (one funded transaction); there is no gas-free enrolment,
   * since a secondary is only recoverable once its ciphertext is on chain.
   *
   * `enrollAccessSlot.viaPairing.{ holder, enroller }` is the cross-device / cross-domain QR ceremony
   * (see SelfCustodyConnection.pairing). `holder` runs on the live wallet and pays; `enroller` runs on
   * the new device/domain and needs no chain access. The facade builds the on-chain AccessCtx.
   */
  enrollAccessSlot: {
    (): Promise<{ slotId: Hex; txId: string; passkeyCount: number }>;
    readonly viaPairing: {
      holder: Omit<SelfCustodyConnection["pairing"]["holder"], "authorize" | "complete"> & {
        authorize(args: { qr: string }): Promise<{ qr: string; sas: string }>;
        complete(args: { qr: string; sasConfirmed: true }): Promise<{ slotId: Hex; txId: string }>;
      };
      enroller: SelfCustodyConnection["pairing"]["enroller"];
    };
  };

  /**
   * THE ACCESS-PATH SETTINGS SURFACE. Everything a "who can reach my wallet" screen needs.
   *
   * `listAccessSlots()` names the DOMAIN that enrolled each passkey — every one of them can reach the wallet
   * key, which is the trust surface a user actually bears (§6.4). It costs one passkey ceremony (the
   * metadata is encrypted under the wallet key). `accessSlotCount()` is the chain-verified number of ways
   * into this wallet.
   *
   * `removeAccessSlot()` removes an access slot and frees it. It is housekeeping, NOT a security control,
   * and no UI may say otherwise: a device that ever signed had the key in memory and could have kept
   * it, and the blob remains in the chain's history regardless. If a device is compromised, MOVE THE
   * FUNDS to a new wallet — both chains. Removing its access slot is not a substitute.
   */
  listAccessSlots(): Promise<(AccessSlotEntry & { rpId: string | null })[]>;
  accessSlotCount(): Promise<number>;
  removeAccessSlot(slotId: Hex, opts: { confirm: true }): Promise<{ txId: string }>;
}

/**
 * Conditional client type: self-custody connections yield the full surface;
 * shared-origin ones use-only.
 *
 * Note the safe-but-surprising direction: the check is on the connection's
 * STATIC type, so widening an own-origin connection to a `Connection`-typed variable
 * under-privileges the client — `createAvokClient({ connection: c })` where
 * `c: Connection` resolves to `UseOnlyAvokClient`, and `.export()`/`.create()`
 * won't compile even though the runtime object is self-custody. Keep the own-origin
 * connection typed as `SelfCustodyConnection` (its factory already returns that)
 * to retain the full surface.
 */
export type AvokClientFor<C extends Connection> = C extends SelfCustodyConnection
  ? FullAvokClient
  : UseOnlyAvokClient;

/** @deprecated back-compat alias; prefer AvokClientFor<C>. Equals FullAvokClient. */
export type AvokClient = FullAvokClient;

export function createAvokClient<C extends Connection>(config: ClientConfig<C>): AvokClientFor<C> {
  const { connection, deps } = config;
  const evmAll = createEvmNamespace(config);
  // __accessSlot is internal plumbing for AccessCtx — it must NOT reach the public client surface.
  const { __accessSlot: _accessSlot, ...evm } = evmAll;
  const solana = createSolanaNamespace(config);

  // State-change fan-out. Fired after any verb that can move account()/status().
  const listeners = new Set<() => void>();
  function notify(): void {
    for (const listener of listeners) listener();
  }

  // Use-only surface — shared by own-origin AND shared-origin. `login` is on both postures.
  const base: UseOnlyAvokClient = {
    async login(o) {
      const a = await connection.continue(o);
      notify();
      return a;
    },
    logout() {
      const r = connection.logout();
      if (r && typeof (r as Promise<void>).then === "function") {
        return (r as Promise<void>).then(() => { notify(); });
      }
      notify();
      return r;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    account: () => connection.account(),
    status: () => connection.status(),
    custody: connection.custody,

    async isActivated(chainId: number): Promise<boolean> {
      const id = resolveChainId(chainId); // throws "chainId is required" if omitted
      const chain = requireChain(config, id); // single call; resolves deps.chain override if set
      const address = connection.account()?.evm.address;
      if (!address) return false;
      // Inline rpc resolution using the already-resolved chain profile (avoids a second getChainProfile).
      const rpc = deps?.rpc ?? makeViemRpc(evmRpcUrl(id, config.rpcUrls));
      const code = await rpc.getCode(address);
      return isDelegatedTo(code, chain.canonicalImplementation);
    },

  };

  // Use-only (shared-origin) posture stops at the use-only surface.
  if (connection.custody !== "self") {
    return base as AvokClientFor<C>;
  }

  // Self-custody posture gains the management verbs.
  const sc = connection as unknown as SelfCustodyConnection;

  // The on-chain access-slot capability the connection's ceremonies borrow: `submit` routes the write
  // through evm.send, and `hasSlot` reads the same chain for idempotency so it can't false-no-op on
  // a mismatch. Shared by addPasskey AND pairing.holder.complete — both write an access slot, whose recovery
  // depends on its slot landing on chain, so both must write through the identical path.
/** 25% over the simulated cost. The gate must be ABOVE the true cost: we would rather tell a user to
 *  top up and be slightly conservative than mint them a passkey that opens nothing. */
const ENROLMENT_BUFFER_BPS = 12_500n;
const withBuffer = (cost: bigint): bigint => (cost * ENROLMENT_BUFFER_BPS) / 10_000n;

const ERC20_BALANCE_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

  function accessCtx(): AccessCtx {
    return {
      /**
       * THE AFFORDABILITY GATE. Runs BEFORE any credential is minted, because creation and the write can
       * never be atomic: a passkey minted into a write the user cannot pay for is an orphan by
       * construction. So we refuse to START what we can already see will not FINISH.
       *
       * It simulates a REPRESENTATIVE access-slot write — a real 61-byte blob and 93-byte metadata against the
       * user's own account — through the same path `send()` uses, so an undelegated wallet's EIP-7702
       * authorization is resolved and priced exactly as it will be in the real transaction (that write
       * IS the type-4 transaction that delegates the account).
       *
       * The threshold is deliberately ABOVE the true cost (a buffer). It is a GATE, not a quote: we
       * would rather tell a user "top up" and be slightly wrong than mint them a passkey that opens
       * nothing.
       */
      assertCanAffordAccessSlot: async (chainId: number) => {
        const addr = connection.account()?.evm.address;
        if (!addr) throw new Error("No wallet active");

        const probe = buildAddAccessSlotCall({
          address: addr,
          slotId: `0x${"11".repeat(32)}`,
          encryptedBlob: new Uint8Array(61).fill(0xab),
          encryptedMeta: new Uint8Array(93).fill(0xcd),
        });
        // Internal management writes are SELF-PAY by default (SPEC §5 — no client-level fee token).
        const sim = await evm.simulate([probe], { chainId, feeToken: null });

        if (sim.fee) {
          // Fronted: the paymaster advances the gas and the user repays in the fee token, so the fee
          // TOKEN balance is what must cover it.
          const token = sim.fee.feeToken;
          const rpc = resolveRpc(config, chainId);
          const balance = await rpc.readContract<bigint>({
            address: token,
            abi: ERC20_BALANCE_ABI,
            functionName: "balanceOf",
            args: [addr],
          });
          const required = withBuffer(sim.fee.amount);
          if (balance < required) throw new EnrolmentUnaffordableError({ chainId, token, required, balance });
          return;
        }

        // Self-pay: native gas, paid by the user directly.
        const rpc = resolveRpc(config, chainId);
        const balance = await rpc.getBalance(addr);
        const gasPrice = await rpc.getGasPrice();
        const required = withBuffer(sim.gasEstimate * gasPrice);
        if (balance < required) throw new EnrolmentUnaffordableError({ chainId, token: null, required, balance });
      },

      submit: (calls: Call[], { chainId }) => evm.send(calls, { chainId, feeToken: null }),

      // ONE gesture for an access-slot write: resolve without the key, seal AND sign inside a single scope,
      // broadcast after. See AccessCtx.prepareWrite for why the probe is exact rather than a guess.
      prepareWrite: (probe: Call[], chainId: number) => evmAll.__accessSlot.prepare(probe, chainId),
      signWrite: (prepared: unknown, calls: Call[], signer: ScopedSigner) =>
        evmAll.__accessSlot.sign(prepared as PreparedAccessSlotWrite, calls, signer),
      broadcastWrite: (prepared: unknown, signed: unknown) =>
        evmAll.__accessSlot.broadcast(prepared as PreparedAccessSlotWrite, signed as SignedAccessSlotWrite),
      hasSlot: async (slotId, chainId) => {
        const addr = connection.account()?.evm.address;
        if (!addr) return false;
        const vaultReader = deps?.vaultReader ?? createViemVaultReader(resolveRpc(config, chainId));
        // A VaultUnreadableError is deliberately NOT caught. hasSlot answers "is this access slot already on
        // chain?", and a chain that did not answer has not said "no". Swallowing it would (a) re-enable
        // the double-write this exists to prevent and (b) defeat the enrolment preflight, which relies
        // on this throwing to refuse an enrolment it cannot finish.
        return (await vaultReader.getAccessSlot(addr, slotId)) !== null;
      },
    };
  }

  const full: FullAvokClient = Object.assign(base, {
    async create(o?: CreateOpts) {
      const a = await sc.create(o);
      notify();
      return a;
    },
    // Enrol a secondary + write its slot on chain in one funded transaction, plus the QR pairing
    // ceremony attached as `.viaPairing`. The AccessCtx routes the write through the send engine.
    // NOTE what does NOT notify in the pairing ceremony: no verb changes the HOLDER's account()/status()
    // — it already had a wallet and still does. And the ENROLLER does not become logged in by enrolling:
    // it receives no key, so it logs in afterwards via login() (which notifies), once the holder's write
    // has landed. holder.complete writes a slot on chain, so the facade injects the same accessCtx.
    enrollAccessSlot: Object.assign(
      async (): Promise<{ slotId: Hex; txId: string; passkeyCount: number }> => {
        const r = await sc.addPasskey(accessCtx());
        notify(); // passkeyCount changed
        return r;
      },
      {
        viaPairing: {
          enroller: sc.pairing.enroller,
          holder: {
            ...sc.pairing.holder,
            // Both verbs need the ctx: authorize to PREFLIGHT the write path before the enroller mints a
            // credential, complete to actually submit. The app assembles neither.
            authorize: (args: { qr: string }) => sc.pairing.holder.authorize({ ...args, ctx: accessCtx() }),
            complete: (args: { qr: string; sasConfirmed: true }) =>
              sc.pairing.holder.complete({ ...args, ctx: accessCtx() }),
          },
        },
      },
    ),

    async exportEvmKey(): Promise<Hex> {
      if (!sc.canExport) throw new Error("connection cannot export");
      return (await sc.export()).evm;
    },
    async exportSolanaKey(): Promise<Hex> {
      if (!sc.canExport) throw new Error("connection cannot export");
      return (await sc.export()).solana;
    },

    listAccessSlots: () => sc.listAccessSlots(),
    accessSlotCount: () => sc.accessSlotCount(),
    removeAccessSlot: (slotId: Hex, o: { confirm: true }) => sc.removeAccessSlot(accessCtx(), slotId, o),

  }) as FullAvokClient;

  return full as AvokClientFor<C>;
}
