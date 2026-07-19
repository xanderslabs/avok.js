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

### The two API surfaces (do not conflate them)

Avok exposes two distinct developer surfaces for two different jobs:

- **Surface 1 — send / sign: `@avokjs/core/provider`.** EIP-1193 (+ EIP-6963 announce) for EVM and
  the Solana Wallet Standard. The dev plugs it into **stock wagmi / viem / ethers /
  @solana/wallet-adapter** and transacts — nothing Avok-specific in how they send. This is all a
  **shared-origin dapp** needs. **Sending and signing are NEVER framework hooks**; they go through
  this provider.
- **Surface 2 — wallet lifecycle: `@avokjs/core` (plain-JS) and the framework facades
  (`@avokjs/react` / `@avokjs/react-native`).** `create` a passkey wallet, `login`, `logout`, account
  state, access-key enrollment, key export. These are Avok-specific operations **no standard covers**
  — there is no wagmi hook for "create a passkey smart wallet" or "add an access key." Only
  **own-origin** apps that own the wallet UX need this.

A shared-origin dapp uses **Surface 1 only**. An own-origin app uses **Surface 2** (lifecycle) plus
**Surface 1** (transacting). This is the two signing paths of §2 seen from the API side.

### How the shared-origin popup works

The SDK **opens and drives** the popup; it does not host the page. `@avokjs/core/channel`'s
`createWebChannel({ authOrigin })` calls `window.open(authOrigin)` (the auth origin root), `postMessage`s
the request in, and accepts a reply only when `event.origin === authOrigin` **and** `event.source` is
the exact popup it opened (5-minute timeout; rejects if blocked). The **page** is provisioned by the
**operator**, once, ahead of time: it is one fully-inlined, CSP-safe static HTML file (`index.html` —
the "wallet-sandbox popup") the operator hosts at their `authOrigin`, built from the
`@avokjs/core/auth-popup` mountable (`mountAuthPopup()` / `<AuthPopup>`) by the hardened-page emitter
(`pnpm emit:auth-page`) — no server. The one page services both requests, dispatching on the request
kind (authorize | sign). Inside the popup the passkey ceremony runs, the wallet **signs in the popup**
under the PRF, and only the result (account on connect, signature on sign) `postMessage`s back — the
key never leaves. This is what keeps "no Avok backend" true: the only thing hosted is the operator's
own static file.

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
  interfaces from account-abstraction (`IAccount`, `PackedUserOperation`). The SDK rail is
  named **sponsored**, but the model is *fronting*: the paymaster advances the gas and the user
  **repays it in the fee token** — not a gift. The contract layer keeps the older word "fronted"
  for exactly this reason; the two terms name the same path, so `fronted/sponsored` above is deliberate.

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
- The plain-JS SDK (`@avokjs/core`) and framework facades (react / react-native) over the above.

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
  is read-only, needs no Avok contract or backend, and lives in `@avokjs/core/helpers`.

## 7. Vocabulary & package naming (decisions)

Package names must match the vocabulary a dev already holds from the config.

| Term / package | Meaning — locked |
|---|---|
| `rpId` | Own-origin config key → in-code signing (§4). |
| `authOrigin` | Shared-origin config key → popup ceremony (§4). |
| access key | A per-origin passkey bound to one underlying wallet (§3). |
| `@avokjs/core/auth-popup` | The mountable (`mountAuthPopup()` / `<AuthPopup>`) + hardened-page emitter behind the popup page a `rpId` owner hosts. The subpath name keeps mirroring the `authOrigin` config key (it was the `@avokjs/auth-origin` package before the restructure). |
| `@avokjs/core/provider` | EIP-1193 (+6963) / Solana Wallet Standard surface. Idiomatic. Note: distinct from React's `<AvokProvider>` — do not conflate. (Was `@avokjs/provider`.) |
| `@avokjs/core/channel` | The client half of the shared-origin channel — the browser counterpart that drives the `auth-popup` page. (Was `@avokjs/shared-origin`, itself renamed from `@avokjs/network`; "network" wrongly reads as chain/RPC config.) |

## 8. Package map (intended single purpose)

**Three published packages** — the shape of a lean industry SDK: one framework-agnostic core plus two
thin framework facades. Each has one clear purpose; anything that duplicates another, or serves an
out-of-scope item, is churn. (This replaces the earlier 11-package layout — 6 of them private and
bundled into `@avokjs/vanilla` — which paid the cost of multi-package for none of the distribution
benefit; the restructure collapsed the private engines into `@avokjs/core` domain folders and made
core public. See `docs/PACKAGE-RESTRUCTURE.md`.)

**Publishing model (load-bearing).** `@avokjs/core` is **public** and *is* the plain-JS/browser SDK.
There are **no private engine packages and no bundling dance** — everything the SDK does lives inside
`core` as domain folders (`src/{wallet,evm,solana,client,provider,channel,...}`) exposed via subpaths.
The old "published packages must source types from `@avokjs/vanilla`, not `sdk-core`" inversion is
**gone**: the facades depend on `@avokjs/core` (react) and `@avokjs/core/engine` (react-native), both
public. `@avokjs/contracts` is published for the addresses / ABIs / EIP-712 types the SDK consumes.

| Package | Single purpose |
|---|---|
| **`@avokjs/core`** | **Public.** The framework-agnostic SDK **and** the plain-JS/browser SDK. Engine, client, provider (Surface 1), shared-origin channel, name resolution, and the auth-popup mountable. Plain-JS devs use it directly. Subpaths: `/engine` (platform-agnostic, no browser globals — the RN base), `/wallet`, `/evm`, `/solana`, `/channel`, `/provider`, `/helpers` (name resolution + utils), `/qr` (browser QR transport), `/auth-popup` (`mountAuthPopup` + hardened-page emitter), `/decode`. |
| **`@avokjs/react`** | React lifecycle hooks + components over `@avokjs/core`: `AvokProvider` + account/lifecycle hooks, management hooks (`useEnroll` / `useExport` / `useAccessSlots`), `<AuthPopup>`, `<SharedOrigin>` / `useAvokConnect()`, `usePairingCeremony()` / `<PairDevice>`. |
| **`@avokjs/react-native`** | RN lifecycle + management hooks (`useEnroll` / `useExport` / `useAccessSlots`) + `createAvokClient(config, wallet)` (symmetric with react — exposes `getEip1193Provider()`; the EIP-6963/Wallet-Standard announce is `window`-gated, firing on RN-web only) + native platform adapter (native passkey + SecureStore), all over `@avokjs/core/engine`. Pairing: `usePairingCeremony()` + `createExpoCameraTransport()` (camera injected). Never statically imports `react-native`/`expo-*`. Native shared-origin channel is a follow-on, not shipped. |
| `contracts` *(`@avokjs/contracts`)* | Published addresses + ABIs + EIP-712 types the SDK consumes (`contracts/src-ts/`). Not the Solidity. |

The three facades are **independent** — none imports another. The browser platform (default web passkey
+ storage) lives in `@avokjs/core` main; RN swaps it via `@avokjs/core/engine` + its native adapter.

Avok's visual identity (tokens, popup styling rules, icon language) is a **reference doc** at `design/`
— not a package. The auth-popup styles its DOM programmatically so nothing external loads; facades and
examples carry their own token CSS.

**White-label identity (the wallet is the operator's, not Avok's).** The name / icon / rdns a dapp
discovers in its wallet picker — EIP-6963 for EVM and the Solana Wallet Standard — is the **operator's**
brand, supplied at wiring time (`createAvokClient(config, wallet)`), never a hardcoded "Avok". Avok is a
white-label SDK (§1): the operator ships *their* wallet on it. `wallet.icon` is optional (a neutral blank
placeholder is used until they provide one); `wallet.name` / `wallet.rdns` are required.

## History

An earlier `VISION-AND-STRUCTURE.md` was meant to be the canonical, tracked source of
truth for Avok. It was lost when the repo history was squashed to a single `avok.js
v0.0.1` commit; the file existed neither on disk nor in git, and `README.md` / `docs/`
were empty. This is the reconstruction, rebuilt from the code and the founder's intent on
2026-07-17, and committed so it cannot silently drift out of the repo again.
