# Avok Contracts Security Model

`AvokWalletImplementation` is an EIP-7702 delegation target. At runtime, `address(this)` is the user EOA.

Protected properties:

- Relayers can only execute calls covered by a wallet EIP-712 signature.
- Nonces and deadlines block replay.
- Backup slots are self-call only.
- Removing the final backup slot requires explicit private-key export confirmation.
- ERC-721 and ERC-1155 safe transfers are handled by OpenZeppelin holder utilities.
- Signature recovery uses OpenZeppelin `ECDSA`, including malformed and high-s signature rejection.
- ERC-777 sender/recipient hooks are no-op accepting hooks and only become discoverable through ERC-1820 after a wallet self-call registers them.

Known constraints:

- The contract is unaudited.
- EIP-7702 semantics and RPC support vary by chain.
- Multi-passkey backup protects against one passkey loss, not loss of all passkeys.
- ERC-777 hooks add callback surface. Integrators must simulate calls and review decoded call summaries before signing or relaying.
- A wallet executor must be able to call arbitrary targets and send native value. Static analysis findings for arbitrary native sends, low-level calls, and calls in loops are expected wallet behavior, not proof of production safety.
- `block.timestamp` is used only for signed intent deadlines. Deadline windows should stay short.

## Static Analysis Baseline

Slither is part of the release gate. Run it with `pnpm --filter @avokjs/contracts slither`
(config: [slither.config.json](./slither.config.json)). The gate is a **clean run
(0 results)**.

A general-purpose wallet executor unavoidably trips several Slither detectors.
Rather than removing the behavior — which would break the wallet — each finding
is triaged in place: every detector below is intentional, justified, and
suppressed with an inline `// slither-disable-next-line` comment in
[`AvokWalletImplementation.sol`](./src/AvokWalletImplementation.sol) carrying the
security rationale.

Triaged findings (`AvokWalletImplementation._execute` / `executeBatchSigned`):

- `arbitrary-send-eth` / `low-level-calls` / `calls-loop`: batch execution forwards
  native value and arbitrary calldata via one raw `call` per entry. Targets,
  values, and calldata are owner-signed via EIP-712 and replay-protected by
  nonce + deadline. A raw call is required to send native value to EOAs.
- `timestamp`: signed-intent deadlines compare against `block.timestamp`; the
  ~12s validator influence is harmless for a coarse expiry check.
- `assembly`: memory-safe assembly bubbles the inner call's revert data verbatim.

Dependency noise (OpenZeppelin / forge-std pragma and version warnings) is
excluded by `filter_paths` in the Slither config; only `src/` is in scope.

Because every detector is suppressed with a documented justification, **any new
Slither finding is unexpected and must be triaged before release** — either fixed
or, if intentional, suppressed with its own inline justification.
