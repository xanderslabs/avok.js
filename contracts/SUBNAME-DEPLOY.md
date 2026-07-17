# Deploying the subname rail (operator runbook)

The subname rail is operator-agnostic: bring your own parent `.eth`, deploy the reference
`AvokSubnameRegistrar`, and set four client-config values. Your users can then mint
`label.<parent>.eth` subnames to their own wallets. Nothing here is specific to any operator.

## 1. Register a parent name

Register a parent `.eth` on ENS (e.g. `qudiid.eth`) on the chain you'll mint on
(Ethereum L1 mainnet, or Sepolia for testing). This is the namespace your users' subnames hang
off. Compute its `namehash` — that's `PARENT_NODE`:

```js
import { namehash } from "viem";
const PARENT_NODE = namehash("qudiid.eth"); // example only — use YOUR parent
```

## 2. Deploy the registrar

The reference registrar is `src/AvokSubnameRegistrar.sol`. Deploy with the forge script; all
inputs are env-driven:

```bash
# Ethereum mainnet: NameWrapper 0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401
#                   PublicResolver 0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63
# Sepolia:          NameWrapper 0x0635513f179D50A207757E05759CbD106d7dFcE8
#                   PublicResolver 0x8FADE66B79cC9f707aB26799354482EB93a5B7dD
NAME_WRAPPER=0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401 \
PARENT_NODE=0x<namehash of your parent> \
VOUCHER_SIGNER=0x<your operator voucher signer address> \
RESOLVER=0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63 \
OPEN_CLAIM=0 \
forge script script/DeployAvokSubnameRegistrar.s.sol:DeployAvokSubnameRegistrar \
  --rpc-url "$RPC_URL" --broadcast
```

The registrar sets the subname's resolver + forward `addr` record (→ the user's wallet) on every
mint, so the name resolves both directions immediately (forward here, reverse via the client's
primary-name set). `RESOLVER` is the ENS public resolver for your chain.

- `OPEN_CLAIM=0` (default): minting requires an EIP-712 voucher signed by `VOUCHER_SIGNER`.
- `OPEN_CLAIM=1`: first-come `claim(label)` with no voucher.
- `FUSES` / `NAME_EXPIRY` default to `0` (a plain user-owned subname). Burning
  `PARENT_CANNOT_CONTROL` requires the parent to be wrapped `CANNOT_UNWRAP` — set fuses only if
  you've prepared the parent for it.

## 3. Delegate the parent to the registrar

As the parent name's owner, authorize the registrar to mint subnodes on the NameWrapper:

```solidity
nameWrapper.setApprovalForAll(<registrar address>, true);
```

## 4. Configure the Avok client + run a voucher signer

```ts
createAvokClient({
  connection,
  subnameParent: "qudiid.eth",        // your parent — a config value, not baked in
  subnameChain: 1,                    // 1 = L1 mainnet, 11155111 = sepolia
  subnameRegistrar: "0x<deployed registrar>",
  subnameVoucherSigner: "0x<your operator voucher signer address>",
});
```

Run a small voucher-signer service: after your first-party surface authenticates a user AND proves
it controls `owner` (a SIWE proof-of-possession, or a session), it signs an EIP-712
`Voucher{ label, owner, expiry }` with the `VOUCHER_SIGNER` key. Use `@avokjs/subnames/server`'s
`buildVoucher` (or the lower-level `voucherDomain` + `signVoucher` from `@avokjs/subnames`).

The app then passes that voucher to `buildSubnameMintCalls` from `@avokjs/subnames` and sends
the returned calls through the wallet — there is no `client.registerSubname` verb: subnames are an
optional add-on and the core has no subname surface (#6).

That's it — your users can mint. Fronted mint (relayer pays L1 gas) or self-pay both work.
