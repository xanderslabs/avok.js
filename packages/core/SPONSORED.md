# Sponsored transactions are bring-your-own

Avok can send transactions whose fee the user pays in an **ERC-20 token or SPL mint** instead of the
chain's native gas asset. It does **not** provide the infrastructure that makes that possible, and it
never will.

Be precise about what "sponsored" means here, because the word is overloaded across the ecosystem.
Avok's sponsored rail is a **token paymaster**: the user holds a paymaster-supported token, the fee is
charged in that token, and the paymaster+bundler collects it and pays the chain in native gas on the
user's behalf. The user still pays — just not in a currency they may not hold.

A **verifying** paymaster is the other shape, reached with `{ sponsored: true }` and no fee token: the
paymaster absorbs the fee outright and the user is charged nothing. That is the onboarding case, since
a brand-new user holds neither gas nor a fee token. Both shapes are the same ERC-7677 handshake and the
same SDK call; which one you get is your paymaster's policy.

There is no default bundler and no default paymaster. A sponsored send is
reachable only through a URL or a client **you** pass in. Supply nothing and every send is native-gas —
that is not a failure mode, it is the default posture.

This holds even if the SDK's authors run sponsorship infrastructure. If Xanders Labs operates a
paymaster, it is a service you may choose to point at, configured exactly like any other provider's.
It gets no privileged position in the SDK, no baked-in URL, no fallback status. From your code it is
indistinguishable from Pimlico or your own deployment, because it is reached the same way: a string
you supply.

The reason is not neutrality for its own sake. Whoever runs the paymaster sees every sponsored
transaction before it lands and decides whether to relay it. A default endpoint would silently make
that party a dependency of every app that never configured one, and a counterparty the end user never
agreed to. `test/evm/sponsored-byo-invariant.test.ts` fails if a default is ever introduced.

## What you supply

### EVM — ERC-4337 bundler + ERC-7677 paymaster

```ts
createAvokClient({
  connection,
  bundlerUrl: "https://...",    // ERC-4337, EntryPoint v0.9
  paymasterUrl: "https://...",  // ERC-7677
});
```

Both are required together. With only one, the chain falls back to native-gas — sponsorship needs
something to price the fee *and* something to submit the operation. Many providers serve both from
one endpoint, in which case pass the same URL twice.

The EntryPoint is the canonical v0.9 singleton. Override per client with `deps.bundler` /
`deps.paymaster` if you serve a different one.

## The interfaces, if you implement your own

URLs cover standards-compliant providers. If yours is not one — a custom auth scheme, a signing proxy,
an in-house relayer — implement the interface directly and inject it. These are the complete contracts;
nothing else is called.

```ts
interface Bundler {
  estimateUserOperationGas(userOp: AvokUserOperation): Promise<EstimateUserOperationGasReturnType>;
  sendUserOperation(userOp: AvokUserOperation): Promise<Hex>;   // returns the userOpHash
  getUserOperationReceipt(hash: Hash): Promise<UserOperationReceipt | null>;  // null while pending
}

interface Paymaster7677 {
  getPaymasterStubData(params: Paymaster7677StubParams): Promise<GetPaymasterStubDataReturnType>;
  getPaymasterData(params: Paymaster7677DataParams): Promise<GetPaymasterDataReturnType>;
}

```

Inject them through `deps`:

```ts
createAvokClient({ connection, deps: { bundler: myBundler, paymaster: myPaymaster } });
```

An injected client takes precedence over the matching URL, and satisfies the both-or-nothing rule on
its own — `deps.bundler` with `paymasterUrl` is a valid pairing.

`AvokUserOperation` is viem's `UserOperation<"0.9">`; the ERC-7677 param types are viem's, with
`entryPointAddress` made optional. Import them from `@avokjs/core/evm`.

## Semantics worth knowing before you rely on it

**Sponsorship is per-send, and there are two ways to ask.** "Who pays" and "in what" are separate
questions. A fee token implies sponsorship; sponsorship does not imply a fee token:

```ts
await client.evm.send(calls, { chainId, sponsored: true });       // paymaster pays; user pays nothing
await client.evm.send(calls, { chainId, feeToken: USDC });        // paymaster fronts; user repays in USDC
await client.evm.send(calls, { chainId });                        // native-gas
```

There is no `defaultFeeToken` and no client-level "always sponsor". A fee token is a payment the user
makes, and a wallet must not choose one on their behalf. Sponsorship is never inferred from your
config either: a client with a paymaster wired up still pays native gas unless the send asks.

The first form is the stock ERC-7677 verifying paymaster, and it is the one that matters for
onboarding. A brand-new user holds no gas **and** no fee token, so a design reachable only through a
fee token cannot sponsor the one transaction that has to be sponsored.

**Asking for sponsorship with no rail configured FAILS.** It does not degrade. The send throws
`SponsorshipUnavailableError` before anything is signed or broadcast, naming which side is missing:

```ts
// paymasterUrl set, bundlerUrl forgotten
await client.evm.send(calls, { chainId, feeToken: USDC });
// SponsorshipUnavailableError: ... bundlerUrl is not configured ...
```

Failing is the default because degrading is worse in both directions. The users this rail exists for
hold the fee **token** and **no native gas**, so a degraded send does not charge them in the wrong
currency, it fails outright on insufficient funds, reporting a native balance rather than the missing
endpoint that caused it. And a user who happens to hold a little native is worse off still: the send
succeeds, spending **their own funds** on gas you intended to sponsor. Neither is something your app
authorised, and a mistyped `PAYMASTER_URL` must not reach anyone as a balance problem.

**There is no degrade, and no flag that enables one.** Asking is binary: served, or an error. Native-gas
sends (no `feeToken`, no `sponsored`) never reach any of this.

**Building a fee-token picker takes care.** There is no method that answers "which tokens do you
take?", because ERC-7677 defines none: which ERC-20s a paymaster accepts is
transaction-scoped and provider-specific, settled when the paymaster accepts or rejects the actual
`pm_getPaymasterStubData` call. `client.evm.feeTokens(chainId)` is only the static REGISTRY catalogue —
what Avok can describe, not what your paymaster charges in — so do not render it as a guarantee. A
paymaster that takes only a subset rejects the rest before signing, and gas-free sponsorship needs no
token picker at all. (A normalized cross-token quote endpoint is a Phase 2 self-host-proxy concern.)

**`receipt.rail` is the only thing that tells you which happened.** It is `"sponsored"` or
`"native-gas"`. If your app promises users gasless transactions, check it rather than assuming your
config took effect:

```ts
const receipt = await client.evm.send(calls, { chainId, feeToken: USDC });
if (receipt.rail !== "sponsored") { /* the user just paid gas — surface it */ }
```

**A sponsored receipt is not a mined transaction.** Its `id` is a userOpHash — an intent id, not a
transaction hash — and its `status` is `"pending"` until the bundler reports a receipt. A native-gas
receipt is `"submitted"`: broadcast, not mined. Neither means "confirmed".

**Fee tokens are chain-specific and validated.** Once sponsorship is reachable, a fee token is checked
against the target chain's registry and rejected with `UnsupportedFeeTokenError` if it means nothing
there — an address that is USDC on one chain is not USDC on another.

## Verifying it actually works

The unit tests cover the wiring with fakes. They cannot tell you your provider works. Against a real
bundler and paymaster on a testnet, confirm:

1. A send with a `feeToken` returns `receipt.rail === "sponsored"` and an `id` that is a userOpHash.
2. The wallet's native balance is unchanged afterwards, and the fee token balance decreased.
3. `getUserOperationReceipt` eventually returns non-null, and the transaction is on chain.
4. An undelegated wallet's first sponsored send carries the EIP-7702 authorization and lands in one
   user gesture.
5. Removing `paymasterUrl` makes the same send **throw** `SponsorshipUnavailableError`, naming
   `paymasterUrl` as the missing side, before any passkey prompt appears. It must not fall through to
   a native-gas send.
6. A send with `{ sponsored: true }` and no `feeToken` returns `rail === "sponsored"` and leaves BOTH
   the native balance and every token balance unchanged.
