import type { Address, AuthorizationRequest, Hex, TransactionSerializable, TypedDataDefinition } from "viem";
import { decodeAbiParameters, decodeFunctionData, erc20Abi, formatUnits, getAddress } from "viem";
import { AvokWalletImplementationABI, getTokenProfile } from "@avokjs/contracts";
import { base64 } from "@scure/base";
import { decodeSolanaConsent, type SolanaConsentView } from "./solana-consent.js";

export interface ConsentLine {
  to: Address;
  valueWei: string;
  kind: "erc20-transfer" | "erc20-approve" | "native" | "raw";
  /** Present for erc20-transfer/erc20-approve: the recipient (transfer) or spender (approve).
   *  `counterparty` + `baseUnits` are always populated; `symbol`/`decimals`/`amount` (the
   *  human-readable form) are populated only when the token is in the registry — an unregistered
   *  token still surfaces recipient + raw base units rather than hiding the transfer as `raw`. */
  token?: { symbol?: string; decimals?: number; amount?: string; baseUnits: string; counterparty: Address };
  raw: Hex;
}

export interface ConsentView {
  chainId: number;
  /** Omitted: ChainProfile carries no human-readable name field. */
  chainName?: string;
  fee?: ConsentLine;
  /** Self-pay: the MOST this signature can cost in native gas (gas × maxFeePerGas). Never an
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
  } catch {
    // Not an ERC-20 call we recognise — fall through.
  }

  // Native ETH transfer: non-zero value, no calldata.
  if (call.value > 0n && call.data === "0x") {
    return { to, valueWei, kind: "native", raw };
  }

  return { to, valueWei, kind: "raw", raw };
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
  version: '1';
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
  | { op: "signUserOp"; userOp: UserOpRequest; chainId: number; authorization?: AuthorizationRequest }
  | { op: "signSolanaTransaction"; messageBytesB64: string; cluster?: string }
  | { op: "signSolanaMessage"; message: string };

/** The v0.8 UserOperation fields the origin needs to recompute the userOpHash and decode the batch.
 *  Only `callData` (the ERC-7821 execute batch) is inspected for consent; the rest feed the hash. */
export type UserOpRequest = { sender: Address; callData: Hex } & Record<string, unknown>;

export type SignConsent =
  | { op: "signTypedData"; view: ConsentView }
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
      /** Self-pay only — see decodeTxConsent. */
      maxFeeWei?: bigint;
      delegation?: Address;
    }
  | { op: "signSponsored"; view: ConsentView; delegation?: Address }
  /** A 4337 sponsored UserOp. `delegation` present ⇒ this ALSO installs the 7702 delegate. The paymaster
   *  charges the fee, so there is no fee line here (fee disclosure is the bounded FeeBreakdown, surfaced
   *  by the SDK's simulate) — only the batched calls and any delegation are shown. */
  | { op: "signUserOp"; chainId: number; calls: ConsentLine[]; delegation?: Address }
  | { op: "signAuthorization"; chainId: number; implementation: Address }
  | { op: "signSolanaTransaction"; view: SolanaConsentView }
  | { op: "signSolanaMessage"; message: string };

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
    decoded = decodeFunctionData({ abi: AvokWalletImplementationABI, data }) as typeof decoded;
  } catch {
    return null; // not a wallet call at all
  }

  const toRawCalls = (calls: readonly unknown[]): RawCall[] =>
    (calls as { to: Address; value: bigint; data: Hex }[]).map((c) => ({ to: c.to, value: c.value, data: c.data }));

  if (decoded.functionName === "execute") {
    // execute(bytes32 mode, bytes executionData) — self-pay.
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
function decodeTxConsent(
  tx: TransactionSerializable,
): { chainId: number; calls: ConsentLine[]; fee?: ConsentLine; maxFeeWei?: bigint } {
  const chainId = tx.chainId ?? 0;
  const call: RawCall = {
    to: getAddress((tx.to ?? "0x0000000000000000000000000000000000000000") as Address),
    value: tx.value ?? 0n,
    data: (tx.data ?? "0x") as Hex,
  };

  // SELF-PAY has no fee call: nobody is reimbursed, the chain debits the wallet's native balance at
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
      const rawChainId = (request.typedData.domain as { chainId?: number | bigint } | undefined)?.chainId;
      if (rawChainId === undefined || rawChainId === null) {
        throw new Error("typedData.domain.chainId is required for signTypedData");
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
          (() => { throw new Error("authorization must carry address or contractAddress"); })(),
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
      // sees the transfers, exactly as a self-pay `signSend` does. There are no 4337 feeCalls (the
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

    case "signSolanaTransaction":
      // Pure decode — no passkey gesture. The signing gate (Task 5) performs the gesture.
      return {
        op: "signSolanaTransaction",
        view: decodeSolanaConsent(base64.decode(request.messageBytesB64), { cluster: request.cluster }),
      };

    case "signSolanaMessage":
      return { op: "signSolanaMessage", message: request.message };

    default: {
      const _exhaustive: never = request;
      throw new Error(`Unknown signing op: ${(_exhaustive as { op: string }).op}`);
    }
  }
}
