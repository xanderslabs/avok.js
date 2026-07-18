// @avokjs/sdk-core/internal — the cross-package seam the provider imports. NOT part of the
// public client surface; exposes the send engine relocated out of the (soon-deleted) client.evm namespace.
export { createSendEngine } from "./send.js";
export type { SendEngine } from "./send.js";
export { createSolanaEngine } from "./solana-send.js";
export type { SolanaEngine, SolanaCluster } from "./solana-send.js";

// The sponsored UserOp assembly, exposed for a FUTURE #9 acceptance harness — a real-bundler testnet
// send that would close the still-open live validateUserOp gate (see SEND-PATH-REDESIGN.md Risks and
// contracts/AUDIT-validateUserOp.md). That harness is NOT yet in the repo. It is the flow #4 shipped —
// including the stub-7702 authorization the bundler needs to simulate against a delegated account — so
// when written, the gate must drive THIS, not a lookalike: a harness that re-derived the assembly
// would prove its own copy works against a real bundler, not that the SDK's does.
//
// Additive and behaviour-free: `internal` already exists to be imported across the package
// boundary, and this adds nothing to the PUBLIC client surface.
export {
  prepareSponsoredUserOp,
} from "../client/sponsored-userop.js";
export type {
  SponsoredInfra,
  PreparedSponsoredUserOp,
} from "../client/sponsored-userop.js";
