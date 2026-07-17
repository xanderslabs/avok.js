# Avok — Vision & Scope

**Status: canonical. Tracked. Supersedes the READMEs where they conflict.**
Reconstructed 2026-07-17 (see *History* at the end for why this file was rewritten).

This document is the yardstick. Anything in the tree that does not trace to something
defined here is churn and is a candidate for deletion. Read this before judging whether
a file, dependency, or package earns its place.

---

## 1. What Avok is

Avok (`avok.js`) is an **open-source, client-side SDK** that gives any app — including
apps with embedded wallets — a **self-custodial smart wallet** authenticated by
**passkeys**. No seed phrase. No browser extension. Everything happens in-app.

- **EVM** wallets are smart EOAs via **EIP-7702**.
- **Solana** is supported too — a deliberate second rail, not an accident.
- The wallet is first-class **both** in its own wallet app **and** embedded on a
  third-party app. Which code path signs is a *property of the passkey↔origin
  relationship*, not a fixed UI (see §2).

## 2. The two signing paths

The passkey's WebAuthn **RP-ID** decides how signing happens:

- **In-code signing** — the passkey's RP-ID *is* the current app's origin, or the
  current origin is authorized to that RP-ID via **ROR / `.well-known` related
  origins**. Signing runs in-app, in code. This is the path for wallet apps, finance
  apps, and game-fi apps with their own embedded-account ecosystem.
- **Shared-origin popup ceremony** — the passkey lives under a *different* origin than
  the current app. Signing happens in a popup opened to that origin. This is the path
  for using your wallet on someone else's dapp (e.g. a Uniswap-style app).

## 3. The wallet & access-key model

One underlying wallet can be reached from **many origins**, each via its own passkey —
**access keys**. This is enforced on-chain by `PasskeyAccessVault`. The analogy: the way
one seed shows up in both MetaMask and Trust — except here each origin gets its own
passkey access key, and it stays fully self-custodial. A wallet created in a wallet app
can be used on a third-party dapp through the shared-origin path, and linked to further
origins by adding access keys.

## 4. Developer configuration contract

The dapp developer knows at build time which side they are on and configures the
provider accordingly. **`rpId` and `authOrigin` are mutually exclusive** — they select
the signing path.

- **Own-origin dapp** (e.g. `example.com`): sets **`rpId: "example.com"`**. Passkeys are
  created and signed **in-code**. This dev makes a second, independent choice — *do I let
  others piggyback on wallets created at my origin?*
  - **Yes** → deploy the Avok signing popup at a subdomain of their choosing, e.g.
    **`auth.example.com`**. That page runs the own-origin code with `rpId: example.com`
    and performs the real signing.
  - **No** → wallets stay usable only within their own network. A user who wants that
    wallet elsewhere must go through an origin that *does* expose the shared path.
- **Shared-origin dapp** (piggybacking): does **not** set `rpId`. Sets
  **`authOrigin: "auth.example.com"`**. The signing path opens the ceremony popup to
  `auth.example.com`, which already carries the own-origin code and signs there.

## 5. Contracts

The contracts are **non-standard**, and Avok is **not chasing an ERC standard yet** —
that is a cost we are choosing not to take on. `contracts/` lives in the repo so there is
a canonical place to deploy from, and so that other devs (or a future standard) have a
concise thing to copy. The SDK consumes deployed **addresses + ABIs + EIP-712 types**
from `contracts/src-ts/`; it does not need the Solidity itself.

- **`PasskeyAccessVault`** — the access-control core. Passkey/PRF vault; enforces the
  access-key model of §3.
- **`AvokWalletImplementation`** — the EIP-7702 delegate. **Dual-mode 7702 + 4337**: it
  exposes one `validateUserOp` so a *fronted/sponsored* send can ride an ERC-4337
  UserOperation through a **bring-your-own ERC-7677 paymaster**. It imports only two
  interfaces from account-abstraction (`IAccount`, `PackedUserOperation`).

So there is **one deployed Avok contract** (`AvokWalletImplementation`, a CREATE2 singleton) with
`PasskeyAccessVault` folded in as an abstract base. Name **registration/minting was removed** —
see §6.

## 6. Scope boundaries (the churn flags)

**IN scope**
- Passkey + access-key wallet primitives; the two signing paths of §2.
- EVM (EIP-7702) and Solana. **Only these two rails.**
- Tx build / simulate / sign / send / track on both rails.
- 4337 **only** as the minimal dual-mode `validateUserOp` path over a BYO paymaster.
- The contract deploy + TS export surface (`contracts/`, `contracts/src-ts/`).
- Framework facades over the above (react / react-native / vanilla).

**OUT of scope — flag any drift toward these as churn**
- ❌ Any **Avok-operated backend / relayer / bundler / KMS**. Client + contracts only;
  gas-fronting is bring-your-own and operator-agnostic.
- ❌ **Social / OAuth / email / custodial recovery.** Passkeys + access-keys only.
- ❌ **Chasing an ERC standard** (yet).
- ❌ **Chains beyond EVM + Solana.**
- ❌ An **Avok bundler / EntryPoint** — 4337 is consumer-side only (§5).
- ❌ **Name REGISTRATION / minting (ENS or SNS subnames).** Removed 2026-07-17: the on-chain
  registrar was built on the ENS **v1 NameWrapper**, which ENS v2 retires, and its replacement
  interface is still work-in-progress — a bad thing to invest in now. This deleted
  `AvokSubnameRegistrar`, the `@avokjs/subnames` package (which had also drifted into an
  out-of-scope voucher **server**), and the SNS registrar code.
- ✅ **Name RESOLUTION stays IN** — resolving `alice.eth` / `alice.sol` → address when *sending*
  is read-only, needs no Avok contract or backend, and lives in `@avokjs/helpers`.

## 7. Vocabulary & package naming (decisions)

Package names must match the vocabulary a dev already holds from the config.

| Term / package | Meaning — locked |
|---|---|
| `rpId` | Own-origin config key → in-code signing (§4). |
| `authOrigin` | Shared-origin config key → popup ceremony (§4). |
| access key | A per-origin passkey bound to one underlying wallet (§3). |
| `@avokjs/auth-origin` | **Keep.** The deployable popup page a `rpId` owner hosts. Mirrors the `authOrigin` config key 1:1 — that mirror outweighs the OIDC/"auth" baggage. |
| `@avokjs/provider` | **Keep.** EIP-1193 (+6963) / Solana Wallet Standard surface. Idiomatic. Note: distinct from React's `<AvokProvider>` — do not conflate. |
| `@avokjs/shared-origin` | **Rename from `@avokjs/network`.** The client half of the shared-origin channel — the browser counterpart that talks to the `auth-origin` popup. "network" wrongly reads as chain/RPC config; this name pairs cleanly with `auth-origin`. |

## 8. Package map (intended single purpose)

Each package must have one clear purpose; anything that duplicates another, or serves an
out-of-scope item, is churn.

| Package | Single purpose |
|---|---|
| `wallet-core` | Local passkey primitives: WebAuthn create, PRF encryption, signing, 7702 delegation checks. |
| `auth-origin` | Static clone-and-own popup page for the shared-origin ceremony. |
| `shared-origin` *(was `network`)* | Browser client that drives the `auth-origin` popup. |
| `provider` | EIP-1193/6963 + Solana Wallet Standard surface over a connection. |
| `txengine` | EVM 7702 tx: simulate / send / track over self-pay and fronted rails. |
| `solana-txengine` | Solana tx: build / simulate / sign / submit / track. |
| `oracle` | Pluggable USD price-feed readers (Chainlink, Pyth) for fee pricing. |
| `helpers` | Read-only name **resolution** (`.eth` / `.sol` → address) + shared utilities. No registration. |
| `sdk-core` | Platform-agnostic facades + utilities the framework facades build on. |
| `react` / `react-native` / `vanilla` | Framework front doors over the core. |
| `@avokjs/design` *(top-level `design/`)* | Workspace-only design tokens + CSP-safe CSS/icons for popups + facades. Not published. |

## History

An earlier `VISION-AND-STRUCTURE.md` was meant to be the canonical, tracked source of
truth for Avok. It was lost when the repo history was squashed to a single `avok.js
v0.0.1` commit; the file existed neither on disk nor in git, and `README.md` / `docs/`
were empty. This is the reconstruction, rebuilt from the code and the founder's intent on
2026-07-17, and committed so it cannot silently drift out of the repo again.
