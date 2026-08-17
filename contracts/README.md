# @avokjs/contracts

Solidity contracts and ABI metadata for Avok EIP-7702 wallets. Publishes both the compiled JS bindings (for backends and frontends) and the raw `.sol` sources (for adopters who want to build or audit them with Foundry).

```bash
npm install @avokjs/contracts
```

## Wallet implementation

`AvokCalibur` is the contract you delegate to via EIP-7702: a subclass of Uniswap's audited Calibur v1.1.0, plus five thin guardian shims and a recovery promotion hook. Calibur provides the multi-key roster (Secp256k1, P256, WebAuthnP256), ERC-7821 batched execution, ERC-4337 `validateUserOp`, ERC-1271, and ERC-7201 namespaced storage — all audited, none of it re-implemented here.

`GuardianLogic` is the stateless rulebook for social recovery. AvokCalibur delegatecalls into it, so every read and write lands in the calling wallet's own account storage under the `avok.guardians` ERC-7201 namespace — there is no shared, stateful recovery manager. It covers guardian setup, guardian-set changes under a vetoable 12h timelock, M-of-N recovery approvals (direct call or EIP-712 signature) that open a 24h timelock, and veto/execute of the resulting recovery.

## ABI imports

```ts
import { AvokCaliburABI, GuardianLogicABI, executeAbi, MODE_BATCH } from "@avokjs/contracts";
```

## Building locally

The repo ships Foundry sources. From the package directory:

```bash
forge build
forge test --offline --disable-labels
```

## Status

Unaudited. The analyzer boundary is honest, not uniform: `GuardianLogic` is fully Slither-analyzable, because it deliberately inherits nothing from Calibur — `slither . --filter-paths "lib|test|script"` reports zero findings against it. The two `block.timestamp` comparisons in the timelock checks and the one inline-assembly usage for the ERC-7201 storage slot are suppressed inline at the site (`slither-disable-next-line`), each with its reason, so the argument is in the source an auditor reads. Any contract that DOES inherit Calibur — `AvokCalibur` included — is invisible to Slither: an upstream IR-generation bug (`'NoneType' object has no attribute 'parameters'`, in Calibur's `ERC7739._isValidTypedDataSig`, verified present on Slither 0.11.5/0.11.6) drops the whole contract from analysis rather than producing a partial or false-clean report. `test/SlitherCanary.t.sol` proves and monitors this: it plants an identical bug in a plain fixture (Slither catches it) and a Calibur-inheriting fixture (Slither misses it), so a future Slither release that fixes the bug fails that test loudly instead of the blind spot going unnoticed. `AvokCalibur`'s delta over audited Calibur is kept small and mechanical for exactly this reason — see `src/AvokCalibur.sol`'s own doc comment. OpenZeppelin components (via Calibur) reduce custom surface but do not make the composed wallet production-safe.

## License

MIT.
