// Re-exported: `readGuardianState` is a general primitive (evm/guardian-reads.ts), not specific to
// recovery — see that module's header. `vault/recover/flow.ts` uses it via this re-export so its own
// imports stay scoped to `vault/recover/`.
export { readGuardianState } from "../../evm/guardian-reads.js";
export type { GuardianConfig, PendingRecovery } from "../../evm/guardian-reads.js";
