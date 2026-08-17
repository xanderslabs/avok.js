# Avok Contracts Security Model

Two contracts ship per chain, both CREATE2 singletons:

- `AvokCalibur` is the EIP-7702 delegation target. At runtime, `address(this)` is the
  user EOA. It is Uniswap's Calibur v1.1.0 (audited by OpenZeppelin and Cantina; reports
  in `lib/calibur/audits/`) plus a small Avok delta: a fallback that forwards guardian
  selectors to `GuardianLogic` by delegatecall, and `registerRecoveredKey`, which is
  self-call only.
- `GuardianLogic` is a stateless rulebook reached only by that delegatecall. All guardian
  state lives in the calling wallet's own storage under the `avok.guardians` ERC-7201
  namespace. It inherits nothing from Calibur.

Protected properties:

- Signing keys are Calibur roster keys (secp256k1, `ecrecover`); key management is
  self-call only, as Calibur defines.
- Anything that changes who controls the wallet waits out a public, vetoable timelock:
  recovery 24 hours, guardian-set changes 12 hours (per-wallet configurable, floor 1
  hour, ceiling 30 days).
- Guardians hold no transaction power. Their only capability is approving a recovery,
  which any current signer can veto during the delay.
- Recovery approvals are EIP-712 typed data bound to the wallet address, a nonce, and the
  chain id; nonces burn on execute and on veto, so stale approvals die.
- `executeRecovery` is anyone-callable after the delay, so a user holding no ETH can be
  recovered; it deletes the pending record before registering the key.
- A recovered key is registered by the wallet's own self-call to `register`; no external
  contract ever holds key-management authority.

Known constraints:

- The Avok delta (`AvokCalibur.sol`, `GuardianLogic.sol`) is unaudited. Calibur's audits
  cover only what is inherited.
- EIP-7702 semantics and RPC support vary by chain; per-chain conformance is gated by the
  E2E suite before any support claim.
- Guardian state is per chain. A recovery executed on one chain restores control there
  only.
- The EOA root key sits above the contract by protocol design: it can re-delegate at any
  time and cannot be revoked. Root-key compromise is out of contract-layer scope.

## Static Analysis Boundary

Slither fully analyzes `GuardianLogic` (it inherits nothing from Calibur); the gate for
it is a clean run. Slither CANNOT analyze any contract inheriting Calibur — an upstream
IR bug in `ERC7739._isValidTypedDataSig` drops such contracts from analysis entirely
(reproduced on Slither 0.11.5 and 0.11.6; Aderyn 0.6.8 panics on the project). A clean
run therefore says nothing about `AvokCalibur.sol`.

What stands in for analysis on the delta: the file stays small and mechanical (branching
logic is forbidden in it), the invariant tests in `test/GuardianRecovery.t.sol` drive
each failure path, and `test/SlitherCanary.t.sol` plants a known bug in a
Calibur-inheriting fixture and asserts Slither misses it — when the upstream bug is
fixed, the canary flips and the blind spot closes. Read `AvokCalibur.sol` yourself; it is
short on purpose.
