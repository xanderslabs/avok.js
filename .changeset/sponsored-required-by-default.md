---
"@avokjs/core": minor
---

Sponsorship is a per-transaction ask that is either served or fails, and the native-gas rail is renamed.

**Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

The semantics below are the `EvmNamespace` (`@avokjs/core/evm`) `send`/`simulate` surface a dapp
reaches through the announced EIP-1193 provider (`wallet_sendCalls`, ERC-5792), not a method on
`AvokClient` itself — the client exposes no `.evm` field:

```ts
// paymaster pays the gas; the user is charged nothing (stock ERC-7677 verifying paymaster)
{ chainId, sponsored: true }

// paymaster fronts the gas; the user repays it in an ERC-20
{ chainId, feeToken: USDC }

// neither: the user pays native gas
{ chainId }
```

- **`ClientConfig.requireSponsorship` is removed.** Strictness moved onto the send, where sponsorship
  is actually asked for. A sponsorship request with no rail configured throws
  `SponsorshipUnavailableError` at build/simulate time, before the passkey ceremony, so no signature is
  taken. There is **no degrade to native gas and no flag that enables one**: a degrade either spends
  the user's own funds on a send the app meant to sponsor, or fails anyway on an error naming a native
  balance rather than the missing endpoint that caused it.
- **Pure sponsorship is reachable.** `{ sponsored: true }` with no `feeToken` now takes the sponsored
  rail. Rail selection previously read the fee token alone, so the sponsored rail was unreachable for a
  user holding no token, and on any chain whose registry lists no fee tokens.
- **`rail: "self-pay"` is renamed to `rail: "native-gas"`** on every receipt, batch and simulation.
  "Self-pay" described who did *not* pay; "native-gas" says what the user actually spends, and it no
  longer implies a binary with "token fee" now that sponsorship can cost the user nothing. Internal
  helpers renamed to match (`selfPayFees` → `nativeGasFees`, `buildSelfPayCalldata` →
  `buildNativeGasCalldata`).
- **"Fronted" is retired** from Avok's vocabulary, including the two error-map keys
  (`fronter_unavailable`, `not_fronted`) that used it — relics of the deleted bespoke relayer that no
  live service sends. Unknown reason codes still surface verbatim, so error diagnostics lose nothing.

Solana-specific behavior originally described here (Kora sponsorship enforcement,
`SponsorshipUnavailableError.solana()`) is dropped from this note: the Solana rail is removed outright
in this same release — see the EVM-only changeset — so documenting a rule for a rail that no longer
ships would be describing dead code.
