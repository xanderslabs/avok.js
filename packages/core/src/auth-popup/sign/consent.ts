/**
 * Decoding a signing request into something a person can read.
 *
 * THE RULE: this module renders ONLY what it derives from the bytes being signed. Nothing the calling
 * app asserts reaches the screen as fact. The app is the adversary the consent screen exists to
 * constrain, the Vault is stateless and cannot check a claim, and a screen that renders an
 * unverifiable number supplied by that app is a consent screen in name only.
 *
 * The native-gas fee line is the worked example: it shows `gas x maxFeePerGas`, the ceiling committed
 * by the signature, and refuses the friendlier estimate an app could hand over.
 *
 * NO NETWORK. The Vault ships `connect-src 'none'`, so there is no ABI lookup, no selector registry,
 * and no simulation. What cannot be decoded from a bundled table is shown in full as raw calldata and
 * marked caution, because not knowing is itself the warning.
 */
import type { Address, AuthorizationRequest, Hex, TransactionSerializable, TypedDataDefinition } from "viem";
import { decodeAbiParameters, decodeFunctionData, erc20Abi, formatUnits, getAddress } from "viem";
import { AvokCaliburABI, getTokenProfile } from "@avokjs/contracts";

/** Value-granting selectors viem's `erc20Abi` does not carry. Kept minimal and literal: this is a
 *  decode table, not an ABI registry, and the Vault has no network to look anything up with. */
const EXTRA_APPROVAL_ABI = [
  {
    type: "function",
    name: "setApprovalForAll",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "increaseAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "addedValue", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

export interface ConsentLine {
  to: Address;
  valueWei: string;
  kind:
    | "erc20-transfer"
    | "erc20-approve"
    | "erc20-increase-allowance"
    | "erc20-transfer-from"
    | "erc721-approve-all"
    | "native"
    | "raw";
  /** Present for every decoded token call: the recipient (transfer), spender (approve, increase),
   *  destination (transferFrom) or operator (approval-for-all).
   *  `counterparty` + `baseUnits` are always populated; `symbol`/`decimals`/`amount` (the
   *  human-readable form) are populated only when the token is in the registry — an unregistered
   *  token still surfaces recipient + raw base units rather than hiding the transfer as `raw`.
   *  `from` is populated only by transferFrom, which moves someone else's tokens.
   *  `approved` is populated only by setApprovalForAll, where the boolean IS the decision. */
  token?: {
    symbol?: string;
    decimals?: number;
    amount?: string;
    baseUnits: string;
    counterparty: Address;
    from?: Address;
    approved?: boolean;
  };
  raw: Hex;
}

export interface ConsentView {
  chainId: number;
  /** Omitted: ChainProfile carries no human-readable name field. */
  chainName?: string;
  fee?: ConsentLine;
  /** Native-gas: the MOST this signature can cost in native gas (gas × maxFeePerGas). Never an
   *  estimate — the ceiling, derived from the signed bytes. Mutually exclusive with `fee`. */
  maxFeeWei?: bigint;
  calls: ConsentLine[];
}

interface RawCall {
  to: Address;
  value: bigint;
  data: Hex;
}

function decodeCall(chainId: number, call: RawCall): ConsentLine {
  const to = getAddress(call.to);
  const valueWei = call.value.toString();
  const raw = call.data;

  // Attempt ERC-20 decode; decodeFunctionData throws on selector mismatch.
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
    if (decoded.functionName === "transfer" || decoded.functionName === "approve") {
      // Both transfer(address,uint256) and approve(address,uint256):
      //   args[0] = recipient/spender (security-critical), args[1] = amount.
      const [recipientArg, amountArg] = decoded.args as [Address, bigint];
      const kind = decoded.functionName === "transfer" ? "erc20-transfer" : "erc20-approve";
      const token: NonNullable<ConsentLine["token"]> = {
        baseUnits: amountArg.toString(),
        counterparty: getAddress(recipientArg),
      };
      // Enrich with the human-readable symbol/decimals/amount only when the token is registered.
      // An unregistered token still surfaces recipient + base units — never hidden as raw calldata.
      const tokenProfile = getTokenProfile(chainId, to);
      if (tokenProfile) {
        token.symbol = tokenProfile.symbol;
        token.decimals = tokenProfile.decimals;
        token.amount = formatUnits(amountArg, tokenProfile.decimals);
      }
      return { to, valueWei, kind, token, raw };
    }
    // transferFrom(address from, address to, uint256): moves tokens the signer may not own, and it
    // is the call an earlier approval exists to enable. Both addresses matter, so both are carried.
    if (decoded.functionName === "transferFrom") {
      const [fromArg, toArg, amountArg] = decoded.args as [Address, Address, bigint];
      const token: NonNullable<ConsentLine["token"]> = {
        baseUnits: amountArg.toString(),
        counterparty: getAddress(toArg),
        from: getAddress(fromArg),
      };
      const p = getTokenProfile(chainId, to);
      if (p) {
        token.symbol = p.symbol;
        token.decimals = p.decimals;
        token.amount = formatUnits(amountArg, p.decimals);
      }
      return { to, valueWei, kind: "erc20-transfer-from", token, raw };
    }
  } catch {
    // Not an ERC-20 call we recognise — fall through.
  }

  // Selectors outside viem's erc20Abi that still grant or move value. Left undecoded these render as
  // raw hex, which is the same as not being described: nobody reads a selector.
  try {
    const decoded = decodeFunctionData({ abi: EXTRA_APPROVAL_ABI, data: call.data });

    // setApprovalForAll(address,bool) is the broadest grant in common use: every token in the
    // collection, now and in future, until revoked. The boolean is the whole decision.
    if (decoded.functionName === "setApprovalForAll") {
      const [operatorArg, approvedArg] = decoded.args as [Address, boolean];
      return {
        to,
        valueWei,
        kind: "erc721-approve-all",
        token: { baseUnits: "0", counterparty: getAddress(operatorArg), approved: approvedArg },
        raw,
      };
    }

    // increaseAllowance(address,uint256) raises an existing allowance. Non-standard but widely
    // deployed, and it grants exactly what approve does.
    if (decoded.functionName === "increaseAllowance") {
      const [spenderArg, addedArg] = decoded.args as [Address, bigint];
      const token: NonNullable<ConsentLine["token"]> = {
        baseUnits: addedArg.toString(),
        counterparty: getAddress(spenderArg),
      };
      const p = getTokenProfile(chainId, to);
      if (p) {
        token.symbol = p.symbol;
        token.decimals = p.decimals;
        token.amount = formatUnits(addedArg, p.decimals);
      }
      return { to, valueWei, kind: "erc20-increase-allowance", token, raw };
    }
  } catch {
    // Not one of these either — fall through to raw, which shows the calldata in full.
  }

  // Native ETH transfer: non-zero value, no calldata.
  if (call.value > 0n && call.data === "0x") {
    return { to, valueWei, kind: "native", raw };
  }

  return { to, valueWei, kind: "raw", raw };
}

/** An EIP-712 payload Avok does not recognise, rendered mechanically so it can still be read.
 *  No ABI and no network: everything here comes from the payload itself. */
export interface GenericTypedDataView {
  domain: { name?: string; version?: string; chainId?: number; verifyingContract?: string };
  primaryType: string;
  fields: { label: string; value: string }[];
}

/** The complete set of fields Avok's own sponsored batch carries. */
const AVOK_BATCH_FIELDS = ["feeCalls", "userCalls", "nonce", "deadline"] as const;

/**
 * Avok's own sponsored batch is the ONE typed-data shape with a bespoke view. Everything else gets
 * the generic renderer.
 *
 * MATCHED ON THE EXACT FIELD SET, not on "has userCalls and feeCalls". That looser test is
 * spoofable: a payload can carry both as empty decoys alongside the real fields of an ERC-2612
 * Permit, and the batch renderer, which reads only the two arrays, would show "no calls" while the
 * user signs a live allowance. Display and signature would describe different things.
 *
 * The signature commits to every message field, so a message carrying anything the batch does not
 * model is not the batch. Such a payload falls through to the generic renderer, where every field
 * including the decoys is shown.
 */
export function isAvokBatchTypedData(message: unknown): boolean {
  if (typeof message !== "object" || message === null) return false;
  const m = message as Record<string, unknown>;
  if (!Array.isArray(m.userCalls) || !Array.isArray(m.feeCalls)) return false;
  const keys = Object.keys(m);
  return keys.length === AVOK_BATCH_FIELDS.length && AVOK_BATCH_FIELDS.every((f) => keys.includes(f));
}

/** Flatten a decoded message into label/value pairs. Nested structs get dotted labels and arrays get
 *  indexed ones, so nothing is summarised away and nothing is hidden behind an ellipsis. */
function flattenFields(value: unknown, prefix = ""): { label: string; value: string }[] {
  if (value === null || value === undefined) return [{ label: prefix || "value", value: String(value) }];
  if (Array.isArray(value)) {
    if (value.length === 0) return [{ label: prefix || "value", value: "(empty)" }];
    return value.flatMap((v, i) => flattenFields(v, `${prefix}[${i}]`));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      flattenFields(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [{ label: prefix || "value", value: typeof value === "bigint" ? value.toString() : String(value) }];
}

function decodeGenericTypedData(typedData: {
  domain?: Record<string, unknown>;
  primaryType?: unknown;
  message?: unknown;
}): GenericTypedDataView {
  const d = typedData.domain ?? {};
  const domain: GenericTypedDataView["domain"] = {};
  if (typeof d.name === "string") domain.name = d.name;
  if (typeof d.version === "string") domain.version = d.version;
  if (d.chainId !== undefined && d.chainId !== null) domain.chainId = Number(d.chainId);
  if (typeof d.verifyingContract === "string") domain.verifyingContract = d.verifyingContract;

  return {
    domain,
    primaryType: typeof typedData.primaryType === "string" ? typedData.primaryType : "(unnamed)",
    fields: flattenFields(typedData.message ?? {}),
  };
}

export function decodeConsent({
  chainId,
  typedData,
}: {
  chainId: number;
  typedData: {
    message: {
      feeCalls: RawCall[];
      userCalls: RawCall[];
      nonce: bigint;
      deadline: bigint;
    };
  };
}): ConsentView {
  const { feeCalls, userCalls } = typedData.message;

  const calls = userCalls.map((c) => decodeCall(chainId, c));
  const fee = feeCalls.length > 0 ? decodeCall(chainId, feeCalls[feeCalls.length - 1]) : undefined;

  return { chainId, calls, fee };
}

// ── decodeSignConsent ─────────────────────────────────────────────────────────

type SiweConsentParams = {
  domain: string;
  uri: string;
  /** Must be '1' — matches viem's SiweParams and the signed EIP-4361 message. */
  version: "1";
  chainId: number;
  nonce: string;
  statement?: string | undefined;
  issuedAt?: Date | undefined;
  expirationTime?: Date | undefined;
  notBefore?: Date | undefined;
  scheme?: string | undefined;
  requestId?: string | undefined;
  resources?: string[] | undefined;
};

/** Local request union — structurally equivalent to the client's `SignRequest` (avoids a circular dep).
 *  Exported so the browser-side signer (`perform-sign.ts`) dispatches over the SAME shape the consent
 *  screen decodes: what the user is shown and what gets signed can never drift apart. */
export type SignConsentRequest =
  | { op: "signMessage"; message: string }
  | { op: "signTypedData"; typedData: TypedDataDefinition }
  | { op: "signSiwe"; params: SiweConsentParams }
  | { op: "signAuthorization"; authorization: AuthorizationRequest }
  | { op: "signTransaction"; tx: TransactionSerializable }
  // Composite ops — one gesture. `authorization` present ⇒ the wallet is still undelegated and this
  // signature ALSO installs the 7702 delegation. The consent screen must disclose that; see below.
  | { op: "signSend"; tx: TransactionSerializable; authorization?: AuthorizationRequest }
  | { op: "signSponsored"; typedData: TypedDataDefinition; authorization?: AuthorizationRequest }
  | {
      op: "signUserOp";
      userOp: UserOpRequest;
      chainId: number;
      /** Which EntryPoint version to recompute the userOpHash against — see `evm/entrypoint.ts`
       *  (duplicated here, not imported: this file mirrors the client's `SignRequest` to avoid a
       *  circular dep, same as everything else in this union). */
      entryPointVersion: "0.8" | "0.9";
      authorization?: AuthorizationRequest;
    };

/** The v0.8 UserOperation fields the origin needs to recompute the userOpHash and decode the batch.
 *  Only `callData` (the ERC-7821 execute batch) is inspected for consent; the rest feed the hash. */
export type UserOpRequest = { sender: Address; callData: Hex } & Record<string, unknown>;

export type SignConsent =
  | { op: "signTypedData"; view: ConsentView }
  | { op: "signTypedDataGeneric"; view: GenericTypedDataView }
  | { op: "signMessage"; message: string }
  | { op: "signSiwe"; fields: Record<string, string> }
  | { op: "signTransaction"; chainId: number; calls: ConsentLine[]; fee?: ConsentLine; maxFeeWei?: bigint }
  /** A composite send. `delegation` is the implementation this ALSO delegates the account to — the
   *  user is approving both, so both are shown. Never omit it when the authorization is present. */
  | {
      op: "signSend";
      chainId: number;
      calls: ConsentLine[];
      fee?: ConsentLine;
      /** Native-gas only — see decodeTxConsent. */
      maxFeeWei?: bigint;
      delegation?: Address;
    }
  | { op: "signSponsored"; view: ConsentView; delegation?: Address }
  /** A 4337 sponsored UserOp. `delegation` present ⇒ this ALSO installs the 7702 delegate. The paymaster
   *  charges the fee, so there is no fee line here (fee disclosure is the bounded FeeBreakdown, surfaced
   *  by the SDK's simulate) — only the batched calls and any delegation are shown. */
  | { op: "signUserOp"; chainId: number; calls: ConsentLine[]; delegation?: Address }
  | { op: "signAuthorization"; chainId: number; implementation: Address };

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
 * Unwrap the wallet's OWN batch so the user sees what they are actually sending.
 *
 * An Avok send is never a bare ERC-20 call: it is a call to the user's own wallet contract —
 * `execute(MODE_BATCH, abi.encode(Call[]))` (ERC-7821) — with the real transfer buried inside
 * `executionData`. The decoder only ever tried `erc20Abi` against the OUTER call, so it matched
 * nothing and every shared-origin send rendered as
 *
 *   ⚠ Unrecognized call to 0x… — value 0 wei, data 0xe9ae5c53…
 *
 * i.e. a wall of hex with no recipient and no amount. The user could not see what they were
 * approving, which makes the consent screen worse than useless: it looks like a safety check while
 * showing nothing. Unwrap one level and the transfer inside decodes normally.
 *
 * Returns null when this is NOT one of our batches (a plain call to some other contract), which then
 * falls through to the existing single-call decode.
 */
function unwrapWalletBatch(data: Hex): { calls: RawCall[]; feeCalls: RawCall[] } | null {
  let decoded: { functionName: string; args: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: AvokCaliburABI, data }) as typeof decoded;
  } catch {
    return null; // not a wallet call at all
  }

  const toRawCalls = (calls: readonly unknown[]): RawCall[] =>
    (calls as { to: Address; value: bigint; data: Hex }[]).map((c) => ({ to: c.to, value: c.value, data: c.data }));

  if (decoded.functionName === "execute") {
    // execute(bytes32 mode, bytes executionData) — native-gas.
    const executionData = decoded.args[1] as Hex;
    try {
      const [calls] = decodeAbiParameters(CALLS_PARAM, executionData);
      return { calls: toRawCalls(calls as readonly unknown[]), feeCalls: [] };
    } catch {
      // A batch we cannot decode must NOT be silently dropped — fall back to showing the raw call.
      return null;
    }
  }

  return null;
}

/** Pure dispatcher — decodes any sign request into a human-readable consent summary. No gesture. */
/** Decode a transaction into the consent view. Shared by `signTransaction` and the composite
 *  `signSend`, so the two can never show the user different things for the same bytes. */
function decodeTxConsent(tx: TransactionSerializable): {
  chainId: number;
  calls: ConsentLine[];
  fee?: ConsentLine;
  maxFeeWei?: bigint;
} {
  const chainId = tx.chainId ?? 0;
  const call: RawCall = {
    to: getAddress((tx.to ?? "0x0000000000000000000000000000000000000000") as Address),
    value: tx.value ?? 0n,
    data: (tx.data ?? "0x") as Hex,
  };

  // NATIVE-GAS has no fee call: nobody is reimbursed, the chain debits the wallet's native balance at
  // inclusion. So there is no fee to decode — but the signature is NOT silent about cost. It commits
  // to a gas limit and a max price, and `gas × maxFeePerGas` is the MOST this signature can cost.
  //
  // That ceiling is the only fee fact derivable from the signed bytes, and it is the only one this
  // screen may show. The app could hand us a friendlier estimate, but the origin is stateless and
  // could not check it — and a consent screen that renders an unverifiable number supplied by the very
  // app it exists to constrain is a consent screen in name only. Show what is signed.
  //
  // Computed BEFORE the batch unwrap, and attached to both paths: a transaction that is not one of the
  // wallet's own batches still commits a gas limit and a max price, and its signer is still entitled to
  // know the cap they are authorising.
  const gas = tx.gas;
  const maxFeePerGas = (tx as { maxFeePerGas?: bigint }).maxFeePerGas;
  const maxFeeWei = gas !== undefined && maxFeePerGas !== undefined ? gas * maxFeePerGas : undefined;

  // An Avok send wraps the real calls inside the wallet's own execute() batch — unwrap it, or the
  // user is shown raw calldata and approves blind.
  const batch = unwrapWalletBatch(call.data);
  if (!batch) {
    return {
      chainId,
      calls: [decodeCall(chainId, call)],
      ...(maxFeeWei !== undefined ? { maxFeeWei } : {}),
    };
  }

  const out: { chainId: number; calls: ConsentLine[]; fee?: ConsentLine; maxFeeWei?: bigint } = {
    chainId,
    calls: batch.calls.map((c) => decodeCall(chainId, c)),
    ...(maxFeeWei !== undefined ? { maxFeeWei } : {}),
  };
  // Exactly one fee call → the fee line. More than one (or zero) → show them as calls, so nothing is
  // ever collapsed away.
  if (batch.feeCalls.length === 1 && batch.feeCalls[0]) {
    out.fee = decodeCall(chainId, batch.feeCalls[0]);
  } else if (batch.feeCalls.length > 1) {
    out.calls = [...batch.feeCalls.map((c) => decodeCall(chainId, c)), ...out.calls];
  }
  return out;
}

export function decodeSignConsent(request: SignConsentRequest): SignConsent {
  switch (request.op) {
    case "signMessage":
      return { op: "signMessage", message: request.message };

    case "signTypedData": {
      const td = request.typedData as unknown as {
        domain?: Record<string, unknown>;
        primaryType?: unknown;
        message?: unknown;
      };
      const rawChainId = td.domain?.chainId as number | bigint | undefined;
      if (rawChainId === undefined || rawChainId === null) {
        throw new Error("typedData.domain.chainId is required for signTypedData");
      }
      // Avok's own sponsored batch keeps its bespoke view. Anything else is described generically
      // rather than refused: a request the Vault cannot render is a request the user cannot approve,
      // and that took out ERC-2612 and Permit2 wholesale.
      if (!isAvokBatchTypedData(td.message)) {
        return { op: "signTypedDataGeneric", view: decodeGenericTypedData(td) };
      }
      const view = decodeConsent({
        chainId: Number(rawChainId),
        typedData: request.typedData as unknown as Parameters<typeof decodeConsent>[0]["typedData"],
      });
      return { op: "signTypedData", view };
    }

    case "signSiwe": {
      const p = request.params;
      const fields: Record<string, string> = {
        domain: p.domain,
        uri: p.uri,
        version: p.version,
        chainId: String(p.chainId),
        nonce: p.nonce,
      };
      if (p.statement !== undefined) fields.statement = p.statement;
      if (p.issuedAt !== undefined) fields.issuedAt = p.issuedAt.toISOString();
      if (p.expirationTime !== undefined) fields.expirationTime = p.expirationTime.toISOString();
      if (p.notBefore !== undefined) fields.notBefore = p.notBefore.toISOString();
      if (p.scheme !== undefined) fields.scheme = p.scheme;
      if (p.requestId !== undefined) fields.requestId = p.requestId;
      // resources: each entry is a URI the user authorises the dapp to access.
      // Join with newlines so a wallet UI can present each resource on its own line.
      if (p.resources !== undefined) fields.resources = p.resources.join("\n");
      return { op: "signSiwe", fields };
    }

    case "signAuthorization": {
      const auth = request.authorization;
      // AuthorizationRequest is OneOf<{ address } | { contractAddress }> — handle both aliases.
      const implementation = getAddress(
        (auth as { address?: Address }).address ??
          (auth as { contractAddress?: Address }).contractAddress ??
          (() => {
            throw new Error("authorization must carry address or contractAddress");
          })(),
      );
      return { op: "signAuthorization", chainId: auth.chainId, implementation };
    }

    case "signTransaction":
      return { op: "signTransaction", ...decodeTxConsent(request.tx) };

    // A COMPOSITE send. Shown exactly like a signTransaction — same decode, so what the user sees and
    // what gets signed cannot drift — plus the delegation, because when `authorization` is present
    // this one approval ALSO installs the 7702 delegate. Approving it blind is the thing to prevent.
    case "signSend":
      return {
        op: "signSend",
        ...decodeTxConsent(request.tx),
        ...(request.authorization ? { delegation: request.authorization.address } : {}),
      };

    case "signSponsored": {
      const view = decodeSignConsent({ op: "signTypedData", typedData: request.typedData });
      if (view.op !== "signTypedData") throw new Error("signSponsored consent: expected a typed-data view");
      return {
        op: "signSponsored",
        view: view.view,
        ...(request.authorization ? { delegation: request.authorization.address } : {}),
      };
    }

    case "signUserOp": {
      // The UserOp's callData IS the wallet's own `execute(MODE_BATCH, calls)` — unwrap it so the user
      // sees the transfers, exactly as a native-gas `signSend` does. There are no 4337 feeCalls (the
      // paymaster charges the fee), so `feeCalls` is always empty here.
      const batch = unwrapWalletBatch(request.userOp.callData);
      const calls = batch
        ? batch.calls.map((c) => decodeCall(request.chainId, c))
        : [decodeCall(request.chainId, { to: request.userOp.sender, value: 0n, data: request.userOp.callData })];
      return {
        op: "signUserOp",
        chainId: request.chainId,
        calls,
        ...(request.authorization ? { delegation: request.authorization.address } : {}),
      };
    }

    default: {
      const _exhaustive: never = request;
      throw new Error(`Unknown signing op: ${(_exhaustive as { op: string }).op}`);
    }
  }
}
