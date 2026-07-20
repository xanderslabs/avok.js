# Sponsored transactions are bring-your-own

Avok can send transactions whose fee the user pays in an **ERC-20 token or SPL mint** instead of the
chain's native gas asset. It does **not** provide the infrastructure that makes that possible, and it
never will.

Be precise about what "sponsored" means here, because the word is overloaded across the ecosystem.
Avok's sponsored rail is a **token paymaster**: the user holds a paymaster-supported token, the fee is
charged in that token, and the paymaster+bundler collects it and pays the chain in native gas on the
user's behalf. The user still pays — just not in a currency they may not hold.

It is NOT a verifying paymaster, where an operator absorbs the fee and the user pays nothing. That is
why a fee token is required to reach this rail: **the token is the payment**, so a send with no fee
token has nothing to charge and is self-pay by definition. An operator who wants to absorb the cost
does that at their own paymaster, as a policy on their side; from the SDK the call is identical.

There is no default bundler, no default paymaster, no default Kora endpoint. A sponsored send is
reachable only through a URL or a client **you** pass in. Supply nothing and every send is self-pay —
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
  bundlerUrl: "https://...",    // ERC-4337, EntryPoint v0.8
  paymasterUrl: "https://...",  // ERC-7677
});
```

Both are required together. With only one, the chain falls back to self-pay — sponsorship needs
something to price the fee *and* something to submit the operation. Many providers serve both from
one endpoint, in which case pass the same URL twice.

The EntryPoint defaults to the canonical v0.8 singleton. Override per client with
`deps.bundler` / `deps.paymaster` if you serve a different one.

### Solana — Kora

```ts
createAvokClient({ connection, koraUrl: "https://..." });
```

One endpoint, because Kora is both the fee payer and the submitter — the Solana analogue of
`bundlerUrl` + `paymasterUrl` together.

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

interface KoraClient {
  getPayerSigner(): Promise<{ payment_address: string; signer_address: string }>;
  getSupportedTokens(): Promise<string[]>;                       // mint addresses
  estimateTransactionFee(txB64: string, feeToken: string): Promise<KoraFeeQuote>;
  signAndSendTransaction(txB64: string): Promise<{ signature: string }>;  // co-signs AND broadcasts
}
```

Inject them through `deps`:

```ts
createAvokClient({ connection, deps: { bundler: myBundler, paymaster: myPaymaster, kora: myKora } });
```

An injected client takes precedence over the matching URL, and satisfies the both-or-nothing rule on
its own — `deps.bundler` with `paymasterUrl` is a valid pairing.

`AvokUserOperation` is viem's `UserOperation<"0.8">`; the ERC-7677 param types are viem's, with
`entryPointAddress` made optional. Import them from `@avokjs/core/evm`.

## Semantics worth knowing before you rely on it

**A fee token is per-send, never a client default.** There is no `defaultFeeToken`. A fee token is a
payment the user makes, and a wallet must not choose one on their behalf:

```ts
await client.evm.send(calls, { chainId, feeToken: USDC });  // sponsored, if infra is configured
await client.evm.send(calls, { chainId, feeToken: null });  // self-pay, explicitly
```

**Without infra, a fee token is silently ignored — unless you say otherwise.** Asking for `feeToken`
on a client with no bundler and paymaster does not throw by default: the send degrades to self-pay
(`SPEC §1`: self-pay everywhere; sponsored only where a bundler+paymaster exist). That is deliberate,
so one codebase can sponsor on the chains where infra exists and pay natively on the ones where it
does not, without branching.

It is also indistinguishable from a mistyped `PAYMASTER_URL`, because both are an absent string. If
your product promises gasless transactions, say so:

```ts
createAvokClient({ connection, paymasterUrl, bundlerUrl, requireSponsorship: true });
```

A fee-token send that cannot reach the sponsored rail then throws `SponsorshipUnavailableError`,
before anything is signed or broadcast, naming which side is missing. Self-pay sends (`feeToken: null`
or omitted) are unaffected — the flag means "when I ask for sponsorship, mean it", not "every send
must be sponsored".

Worth being concrete about what the default costs you when it is wrong. The users this rail exists for
hold the fee **token** and **no native gas**, so a degraded send does not quietly charge them in the
wrong currency — it fails outright on insufficient funds, an error naming a native balance rather than
the missing endpoint that caused it.

**`receipt.rail` is the only thing that tells you which happened.** It is `"sponsored"` or
`"self-pay"`. If your app promises users gasless transactions, check it rather than assuming your
config took effect:

```ts
const receipt = await client.evm.send(calls, { chainId, feeToken: USDC });
if (receipt.rail !== "sponsored") { /* the user just paid gas — surface it */ }
```

**A sponsored receipt is not a mined transaction.** Its `id` is a userOpHash — an intent id, not a
transaction hash — and its `status` is `"pending"` until the bundler reports a receipt. A self-pay
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
5. Removing `paymasterUrl` makes the same send return `rail === "self-pay"` — proving the degrade is
   reachable and observable rather than theoretical.

On Solana, the same shape: `koraUrl` set, fee paid in the SPL token, native SOL untouched, and the
returned signature findable on chain.
