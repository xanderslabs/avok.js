/**
 * Turn a decoded `SignConsentRequest` into a `vault/simulate` `SignTxPayload`, PRE-GESTURE — the
 * consent screen must be able to show simulated asset deltas before the user has approved anything,
 * so this reads only the request bytes themselves, never a passkey-derived key or wallet state.
 *
 * SELF-CALL SHAPE. Every Avok transaction is the wallet calling itself: `tx.to` (signTransaction /
 * signSend) or `userOp.sender` (signUserOp) already names the wallet's own address (see
 * `perform-sign.ts`'s header comment — the client builds these from `connection.account()`), and the
 * wallet is both the sender and the target of the outer call. Simulating that outer call exactly as it
 * will be sent — no batch-unwrapping needed here, unlike the display decoder — reproduces the same
 * Transfer/Approval logs a real submission would emit, because `eth_simulateV1` runs the wallet's own
 * `execute()` and its logs come out the same way either way.
 *
 * signTypedData / signSponsored are different: they carry the wallet's own EIP-712 batch directly
 * (`feeCalls` + `userCalls`, already flat `{to,value,data}` tuples — see `isAvokBatchTypedData`), signed
 * for a relayer to submit later. There is no outer self-call to simulate; the calls themselves ARE the
 * payload, run against the wallet named by the domain's `verifyingContract`.
 *
 * Returns null for anything that grants no on-chain call to simulate: signMessage, signSiwe,
 * signAuthorization (a bare 7702 authorization has no calldata), and a signTypedData request that is
 * NOT the Avok batch (a generic EIP-712 signature, e.g. Permit2 — nothing here can safely guess what a
 * relayer will do with an arbitrary struct).
 */
import { getAddress, type Address, type Hex } from "viem";
import { isAvokBatchTypedData, type SignConsentRequest } from "./consent.js";
import type { SignTxCall, SignTxPayload } from "../../vault/simulate/index.js";

type RawCall = { to: Address; value: bigint; data: Hex };

function toSignTxCall(c: RawCall): SignTxCall {
  return { to: getAddress(c.to), value: c.value, data: c.data };
}

/** signTransaction and signSend share this shape exactly — see the module header. */
function payloadForTx(tx: { to?: Address | null; value?: bigint; data?: Hex; chainId?: number }): SignTxPayload | null {
  // A `to`-less transaction is a contract deployment, which is never how the wallet sends anything —
  // there is no self-call to simulate.
  if (!tx.to) return null;
  if (tx.chainId === undefined || tx.chainId === null) return null;
  const wallet = getAddress(tx.to);
  return {
    chainId: tx.chainId,
    account: wallet,
    calls: [{ to: wallet, value: tx.value ?? 0n, data: (tx.data ?? "0x") as Hex }],
  };
}

/** signTypedData and signSponsored share this shape exactly — see the module header. */
function payloadForAvokBatch(typedData: {
  domain?: { chainId?: number | bigint; verifyingContract?: string };
  message?: unknown;
}): SignTxPayload | null {
  if (!isAvokBatchTypedData(typedData.message)) return null;
  const domain = typedData.domain;
  const verifyingContract = domain?.verifyingContract;
  const rawChainId = domain?.chainId;
  if (typeof verifyingContract !== "string" || rawChainId === undefined || rawChainId === null) return null;
  const m = typedData.message as { feeCalls: RawCall[]; userCalls: RawCall[] };
  return {
    chainId: Number(rawChainId),
    account: getAddress(verifyingContract),
    calls: [...m.feeCalls, ...m.userCalls].map(toSignTxCall),
  };
}

export function simulationPayloadFor(request: SignConsentRequest): SignTxPayload | null {
  switch (request.op) {
    case "signTransaction":
    case "signSend":
      return payloadForTx(request.tx as unknown as Parameters<typeof payloadForTx>[0]);

    case "signUserOp":
      return {
        chainId: request.chainId,
        account: getAddress(request.userOp.sender),
        calls: [{ to: getAddress(request.userOp.sender), value: 0n, data: request.userOp.callData }],
      };

    case "signTypedData":
    case "signSponsored":
      return payloadForAvokBatch(request.typedData as unknown as Parameters<typeof payloadForAvokBatch>[0]);

    case "signMessage":
    case "signSiwe":
    case "signAuthorization":
      return null;

    default: {
      const _exhaustive: never = request;
      throw new Error(`Unknown signing op: ${(_exhaustive as { op: string }).op}`);
    }
  }
}
