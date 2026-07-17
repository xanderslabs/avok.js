export type TxState = "idle" | "signing" | "pending" | "confirmed" | "failed";
export type TxEvent = "submit" | "signed" | "mined" | "revert" | "reject" | "reset";

const TRANSITIONS: Record<TxState, Partial<Record<TxEvent, TxState>>> = {
  idle:      { submit: "signing" },
  signing:   { signed: "pending", reject: "failed" },
  pending:   { mined: "confirmed", revert: "failed" },
  confirmed: { reset: "idle" },
  failed:    { reset: "idle" },
};

/** Guarded transition: unknown (state,event) pairs are no-ops (return state). */
export function txReduce(state: TxState, event: TxEvent): TxState {
  return TRANSITIONS[state][event] ?? state;
}
