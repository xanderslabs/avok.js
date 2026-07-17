# Audit brief — `AvokWalletImplementation.validateUserOp`

**Status: OPEN — not yet commissioned.** Written so a firm can scope and quote from this document alone.

Avok is an EIP-7702 passkey wallet SDK. Sub-project #4 made the wallet implementation **dual-mode 7702 + 4337** by adding one `validateUserOp`, so that a *fronted* (sponsored) send can go through an ERC-4337 UserOperation and a bring-your-own ERC-7677 paymaster. That addition is what needs an audit.

## Scope

| | |
|---|---|
| **In scope** | `contracts/src/AvokWalletImplementation.sol` — one file. Solidity `0.8.29`. |
| **Deployed as** | The canonical delegate at CREATE2 **`0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C`**, the target of every user's EIP-7702 delegation. |
| **EntryPoint** | ERC-4337 **v0.8**, hardcoded as `ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` (`AvokWalletImplementation.sol:52`). |
| **Out of scope** | The passkey/PRF vault design (it belongs to the CC0 `passkey-access-vault` standard and #4 did not touch it), the SDK/TypeScript, the paymaster (bring-your-own, not ours). |

**The account is an EOA.** Under EIP-7702 the user's own EOA delegates to this implementation; there is no factory and no counterfactual deployment. `address(this)` **is** the user's address.

## The design's claims — please attack these

**1. `validateUserOp` is a plain `ecrecover`, and that is sufficient.**

```solidity
function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
    external returns (uint256 validationData)
{
    if (msg.sender != ENTRY_POINT) revert Unauthorized();
    validationData = _recover(userOpHash, userOp.signature) == address(this) ? 0 : 1;
    if (missingAccountFunds != 0) {
        (bool ok,) = msg.sender.call{value: missingAccountFunds}("");
        ok; // EntryPoint re-checks the actual deposit
    }
}
```

The claim: **K IS the EOA key.** The wallet key derived from the passkey *is* the EOA's secp256k1 key, so the signer 4337 must authenticate is the same key that would sign an ordinary self-pay transaction. Hence no signer registry, no owner storage, no P256 verification — a UserOp is valid exactly when the account itself signed it. Returns `0`/`1`; no time-range packing (no `validAfter`/`validUntil`).

**2. `execute` is gated.**

```solidity
if (mode == MODE_BATCH) {
    if (msg.sender != address(this) && msg.sender != ENTRY_POINT) revert Unauthorized();
    _execute(...);
} else if (mode == MODE_BATCH_OPDATA) {
    _executeWithOpData(executionData);   // NOT sender-gated — signature-gated instead
}
```

`MODE_BATCH` admits only a self-call (7702 self-pay) or the EntryPoint forwarding a validated UserOp. `MODE_BATCH_OPDATA` is deliberately callable by **anyone** and is authorised by an EIP-712 signature instead (`_recover(digest, signature) != address(this)` reverts), plus `_consume(nonce, deadline)`.

**3. The two modes cannot forge each other**, despite sharing `_execute`.

**4. Two independent nonce spaces coexist**: EntryPoint's 2D nonce (the 4337 path) and the contract's own `nonceBitmap` (the `MODE_BATCH_OPDATA` path, `nonceBitmap[nonce >> 8] & (1 << (nonce & 0xff))`).

**5. The ERC-7201 storage root is unchanged** by #4's additions: `0xa4fa4294098059eabd10052f01eef3d8d7de7be8acc14248ecb1c1794a130600`.

## The questions we want broken

1. **Can the two nonce spaces be replayed against each other?** A UserOp consumes an EntryPoint nonce; `MODE_BATCH_OPDATA` consumes a `nonceBitmap` bit. They never check each other. Can a batch authorised for one path be replayed through the other?
2. **Cross-chain / cross-account replay.** `domainSeparator()` binds `block.chainid` and `address(this)`, and the v0.8 `userOpHash` binds the chain id and EntryPoint. Is anything signed here replayable onto another chain, or onto another account that delegates to the same implementation at the same address?
3. **`_recover` hardening.** It wraps `ECDSA.tryRecover` and returns `address(0)` on any error, so validation fails closed. Is there any input for which it returns `address(this)` without a genuine signature — malleability, a zero/garbage signature, an EOA with no code?
4. **The prefund forward.** `validateUserOp` forwards `missingAccountFunds` to `msg.sender` and **ignores failure** (per ERC-4337; the EntryPoint re-checks the deposit). Is ignoring `ok` exploitable — reentrancy, or griefing the account's balance?
5. **ERC-7562 anti-griefing.** Does validation touch anything a bundler would reject or that enables mempool griefing?
6. **A malicious/compromised paymaster.** Can it steal, over-charge, or grief the account beyond the fee it sponsors? The paymaster is bring-your-own and untrusted by design.
7. **The first-send EIP-7702 authorization.** An undelegated account's first fronted send attaches a `SignedAuthorization`. The SDK signs the UserOp hash and the authorization tuple **separately**; the v0.8 `userOpHash` is independent of the authorization signature. Can a captured authorization be replayed or bound to a different delegate?
8. **The canonical singleton assumption.** `ENTRY_POINT` is hardcoded to the same address on every chain. What happens on a chain where v0.8 is **not** deployed at that address, or where something else is?

## Frozen — a finding here has a cost

These must not move; **any source change moves the CREATE2 address**, because Foundry's metadata hash embeds source content:

| | Value |
|---|---|
| Canonical impl (CREATE2) | `0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C` — cross-checked in **16** places |
| ERC-7201 storage root | `0xa4fa4294098059eabd10052f01eef3d8d7de7be8acc14248ecb1c1794a130600` — changing it strands every existing wallet |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| Conformance vectors | `passkey-access-vault/vectors/vectors.json` — the definition of interop |

**Please state this in the engagement.** A "just tweak this line" recommendation is not free here: it moves the delegate address and forces a re-deploy plus an update across all 16 homes. We would rather know that when weighing a finding's severity.

## Current state

- `forge test --offline`: **68/68** passing.
- `validateUserOp` has **never run against a real EntryPoint** — only against tests. The first live exercise is `examples/scripts/acceptance-evm-fronted/run.sh` (a testnet send through a real bundler + paymaster), which is still an open gate.
- A green send from that harness would prove `validateUserOp` **accepts a good signature**. It would not prove it **rejects every bad one** — that is what this audit is for.
