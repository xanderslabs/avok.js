---
"@avokjs/vault": minor
---

The Vault's CSP pins the exact RPC set it's built for, and it ships a "Recover a wallet" screen.

**Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

- **`connect-src` is no longer `'none'`.** It is now the exact set of RPC origins the operator
  configures (`chains`, plus any `rpcOverrides`), computed once at build time and asserted again at
  deploy time. `avok-vault build` refuses to emit a page whose CSP doesn't match its own config
  (`assertVaultInvariants`); `avok-vault check` re-derives the expected header set from the same
  config and diffs it against what a deployed URL actually serves (`evaluateDeployedHeaders`), so a
  proxy or CDN silently rewriting headers after deploy is caught, not assumed away.
- **`chains` is now a required field in the Vault's own config, and `rpcOverrides` is optional.**
  Both feed the CSP computation above; there is no longer an implicit "any RPC" trust boundary.
- **New: the Vault's "Recover a wallet" screen**, driving the on-chain guardian recovery flow
  (approve, execute, veto) end to end from a guardian's own passkey. This is the Vault-side
  counterpart to the `evm/build*GuardianOpCall`/`readGuardianState` primitives added to
  `@avokjs/core` (see the roster-and-guardian-management changeset) — those primitives build the
  calldata; this screen is what actually walks a guardian through signing and sending it.
