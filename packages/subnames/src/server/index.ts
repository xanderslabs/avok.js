/**
 * NODE-ONLY. The operator's registration backend: it holds the voucher signing key, so it must
 * never be bundled into a browser. This is NOT the auth-origin popup (VISION §7's "no server
 * secret" is about that popup) — it is the operator's own subname-issuance service.
 *
 * ⚠️ YOU MUST GATE `buildVoucher` ON PROOF THAT THE CALLER CONTROLS `owner`.
 * These are library functions, not an endpoint: #6 removed the auth origin's `POST /subname/voucher`
 * route (it was entangled with the auth origin's challenge machinery), so the proof-of-possession
 * gate the route provided is now YOUR responsibility. The deleted reference recovered `owner` from a
 * SIWE signature over a single-use server challenge — it never trusted a client-supplied `owner`.
 * Sign for an unproven `owner` and anyone can mint a name to any address.
 */
export { buildVoucher } from "./voucher.js";
export { createLabelPolicy, LabelNotIssuableError, type LabelPolicyConfig } from "./policy.js";
