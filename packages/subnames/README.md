# @avokjs/subnames

The **optional** subname REGISTRATION add-on: pure builders for minting ENS subnames
(`label.<parent>.eth`) and SNS subdomains (`label.<parent>.sol`) under an operator's namespace.
No wallet state, no custody — just name math, the EIP-712 operator voucher, the registrar call
builders, and the mint fee.

**The Avok core never depends on this package.** Install it only if your app mints names; the
wallet works without it. (Name RESOLUTION is not here — it lives in `@avokjs/helpers`
(`createNameResolver`), which is core-safe and needs no add-on.)

**BUILD-ONLY — it returns calls; it never sends them.** `buildSubnameMintCalls` hands you a
`Call[]` and `buildSnsMintIx` an instruction list; you submit them through the standard wallet
surface (`wallet_sendCalls` from a dapp, or the SDK's tx namespace from an own-origin app). That is
exactly what lets this package be optional: it needs no send seam from the core.

```ts
import { buildSubnameMintCalls } from "@avokjs/subnames";

const { name, calls } = await buildSubnameMintCalls({
  label, owner, parent, registrar, client: publicClient, solanaAddress, voucher,
});
// [approve?, mint, setPrimary] — order is load-bearing: the registrar PULLS the fee during mint.
await provider.request({ method: "wallet_sendCalls", params: [{ from: owner, calls }] });
```

## `@avokjs/subnames/server` (node-only)

`buildVoucher` + `createLabelPolicy` — the operator's voucher-issuing backend. It holds the signing
key, so it must never be bundled into a browser.

> ⚠️ **You must gate `buildVoucher` on proof that the caller controls `owner`.** It signs for
> whatever owner you pass it. #6 removed the reference route that did this (which recovered `owner`
> from a SIWE proof-of-possession over a single-use challenge rather than trusting the request
> body), so that gate is now your responsibility. Without one, anyone can mint a name to any address.

Any operator brings its own parent `.eth` + config and deploys the reference
`AvokSubnameRegistrar` (in `@avokjs/contracts`). Nothing here is hardcoded to any operator.

## Surface

- `normalizeSubname`, `subnameNode`, `fullName`, `subnameNode` — ENS name math.
- `Voucher`, `voucherDomain`, `signVoucher`, `recoverVoucherSigner` — EIP-712 operator voucher.
- `createVoucherRegistrarCallBuilder`, `createOpenClaimRegistrarCallBuilder`, `buildSetPrimaryNameCall` — mint + primary-name calls.
- `createEnsReader` — availability (ENS registry owner), forward + reverse (Universal Resolver) reads.
