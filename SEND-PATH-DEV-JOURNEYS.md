# Send-path dev journeys — grounding the redesign

**Status: working grounding doc for [[SEND-PATH-REDESIGN.md]].** Companion to
[[VISION-AND-STRUCTURE.md]] (the yardstick). Written 2026-07-17 while grounding the send-path
redesign against **how a developer actually codes each path**, per the vision.

## Why this exists

Before executing the redesign we trace the concrete developer journeys — a swap and an NFT mint,
on EVM and Solana, through both signing paths (own-origin / shared-origin) and both gas methods
(self-pay / sponsored). Each journey is written in three layers: **(a)** the exact code the dev
writes, **(b)** the internal path, **(c)** what the redesign changes and must not break. The point is
to ground the redesign's claims (chiefly "the wallet already batches via ERC-7821") against real
usage and to surface gaps before touching code.

**The demos are stale — do not ground against them.** `examples/*/src/screens/Send.tsx` still call
`client.evm.send` / `client.solana.send` directly. That contradicts the vision and the *current
package code*: `packages/react/src/hooks.ts` states plainly that **sending/signing are NOT hooks —
they go through the announced EIP-1193 provider (EVM) and the Solana Wallet Standard wallet, driven
by stock wagmi/viem / @solana/wallet-adapter; the old useSend/useSimulate/useSign hooks are gone.**
So the vision-target is already real in the packages; the demo *screens* are the drift. We ground
against the vision + package code, not the demo screens.

---

## The model on one page

### Two surfaces, one config

`config` is authored **once** by the dev and feeds **both** surfaces:

```ts
// config.ts — authored once. Own-origin ⇒ rpId (in-code signing); shared-origin ⇒ authOrigin (popup).
export const config = { rpId: "app.example.com", rpcUrls, paymasterUrl, bundlerUrl, koraUrl };

const connection = createOwnOriginConnection({ rpId: config.rpId, ... });   // ← own vs shared lives HERE
//         shared-origin instead:  createSharedOriginConnection({ authOrigin })
const client = createAvokClient({ connection, rpcUrls: config.rpcUrls,
                                  paymasterUrl: config.paymasterUrl, bundlerUrl: config.bundlerUrl, koraUrl: config.koraUrl });
```

- **Surface 2 — lifecycle (`@avokjs/react` / `vanilla`).** `<AvokProvider client={client}>` +
  `useCreate` / `useLogin` / `useLogout` / `useAccount`. Creates/authenticates the passkey wallet.
  Own-origin apps use this; shared-origin dapps do not (they don't manage custody).
- **Surface 1 — transact (`@avokjs/provider`).** `client.getEip1193Provider()` → `announceEip6963(...)`
  → **stock wagmi/viem**. `useSendCalls` / `useCallsStatus` / `useCapabilities`. Solana:
  `registerAvokSolanaWallet` → `@solana/wallet-adapter`. **Both** own- and shared-origin transact
  through this identical surface.

### The config model

- **`rpcUrls` is an optional per-chain *override*, not an allowlist.** The set of *known* chains is
  the **registry** (`contracts/src-ts/registry.ts` → `CHAIN_PROFILES`), not config. Any registry
  chain works; an unset endpoint falls back to the registry's **public** endpoint —
  **development-only** (rate-limited, no SLA, 403s indexed reads). Production overrides only the
  chains it uses, with its own key/proxy. Rationale: an RPC answers name-resolution, a trust
  boundary — Avok ships no third-party default, so a lying endpoint can't be the silent default.
  The only chain in config is `anchorChainId` (own-origin) — *where access-key slots anchor*,
  unrelated to which chain a send runs on.
- **A send's chain is per-call, from wagmi.** `chainId` has no client default (`resolveChainId`
  throws if omitted). wagmi's active chain rides in `wallet_sendCalls({ chainId })`;
  `wallet_switchEthereumChain` moves it. The RPC for that chain is resolved from `rpcUrls[chainId]`
  or the public default.
- **Self-pay vs sponsored is two layers — configuring a paymaster does NOT auto-sponsor.**
  - *Layer 1 (capability):* `paymasterUrl` **and** `bundlerUrl` set → `canFront()` (EVM); `koraUrl`
    set (Solana). Missing → sponsorship impossible; everything self-pays.
  - *Layer 2 (per-send choice):* `railFromContext` = **`feeToken ? "sponsored" : "self-pay"`**.
    Through the provider: `capabilities.paymasterService` present → sponsored (fee token in its
    `context`); absent → self-pay.
  - **No global "sponsor everything" flag.** Bundler+paymaster make sponsorship *available*; each
    send is sponsored only if *sent with a fee token*. Default = self-pay.
  - *Who picks the token?* The user/dapp, per send — never a client default ("a wallet must not pick
    a payment token on the user's behalf"). Options come from `wallet_getCapabilities → feeTokens`.
  - *Degradation:* a sponsored request on an app with no sponsor infra silently falls back to
    self-pay (SPEC §1), never errors.
  - *Avok nuance vs vanilla ERC-7677:* the **paymaster URL is the operator's** (from `config`), not
    the dapp's. The dapp's `paymasterService.context.token` names only the **fee token**; the
    provider ignores a dapp-supplied `url` and uses the operator-configured paymaster/bundler
    (`eip1193-methods.ts` `wallet_sendCalls`). Matches the vision's "gas-fronting is BYO and
    operator-agnostic": the operator configures the paymaster, the dapp/user picks whether+which token.

### The rail is a runtime choice — Journeys 1 and 2 are one build, not two

Splitting self-pay and sponsored into separate journeys is a tracing convenience. In a real app the
rail is a **per-send choice the user makes**, not a build-time constant. The dev renders a fee-mode
toggle and — when sponsored — a fee-token picker fed by `wallet_getCapabilities`, then attaches the
capability conditionally:

```ts
const { data: caps } = useCapabilities();
const canSponsor = (caps?.[chainHex]?.feeTokens?.length ?? 0) > 0;   // infra AND ≥1 supported token
// user toggles the rail; if sponsored, user picks feeToken from caps[chainHex].feeTokens
sendCalls({
  calls: [approve, swap],                                            // identical either way
  ...(rail === "sponsored" && feeToken
      ? { capabilities: { paymasterService: { context: { token: feeToken } } } }
      : {}),                                                         // self-pay: no capability
});
```

Same batch, same code path — only the *presence of the capability* differs. This is exactly why
`railFromContext` is `feeToken ? "sponsored" : "self-pay"` and the fee token has **no client
default**: the choice belongs to the user, per send. If the user picks sponsored but no infra/token
exists, it degrades to self-pay.

### Where consent lives — **Gap A resolved: (ii)**

"Sign-what-you-saw" needs the bounded fee shown *before* the single passkey gesture. The provider
exposes only fire-and-forget `wallet_sendCalls` + `wallet_getCallsStatus` — no prepare/quote method.
**Decision: the wallet owns consent** — Avok's connection renders an **in-page consent component**
(own-origin) or the **popup** (shared-origin) carrying the fee, right before the biometric. The dapp
never produces a fee number. (Rejected alternative: add a `wallet_prepareCalls` provider method for
the dapp to fetch a quote — more surface, pushes fee rendering onto the dapp.)

### Open gaps

- **Gap B — Solana sponsored has no standard slot. RESOLVED: both rails routable via `client.solana`;
  self-pay ALSO stock; the dev picks.** The Solana Wallet Standard has no `paymasterService`/5792
  equivalent, so sponsorship can't ride stock tooling. **Decision:**
  - **Solana self-pay** is reachable **two ways** — stock Wallet Standard (`@solana/wallet-adapter`,
    *zero rewrite* for a dapp with existing self-pay code that just swaps in an Avok wallet) **and**
    `client.solana` (the unified Avok API). The developer picks based on how much existing code they
    have.
  - **Solana sponsored** is `client.solana` only (Kora orchestration) — *not* a Wallet-Standard
    custom feature. A custom feature would be proprietary dressed as a standard, with no stock
    consumer (`@solana/wallet-adapter` wouldn't call it), so it buys nothing over an honest Avok API
    and violates YAGNI.
  - Both entry points already exist in the code; we bless both rather than deprecate either. This is
    an ecosystem limitation (no Solana standard expresses relayer sponsorship + fee-token choice), not
    an Avok shortcut — so "send with stock tooling" holds for **all EVM** and **Solana self-pay**,
    with **Solana sponsored** the one documented exception. Reflect in [[SEND-PATH-REDESIGN.md]] /
    [[VISION-AND-STRUCTURE.md]].

---

## The journey matrix

EVM reference chain = **Base (8453)**. Tx shapes: **swap** = 2-call batch (`approve` + `swap`) →
the ERC-7821 `execute(MODE_BATCH)` case; **NFT mint** = single call. Assume the user already
created/authenticated their wallet via Surface 2.

| # | Chain | Path | Gas | Shape | Status |
|---|---|---|---|---|---|
| 1 | EVM/Base | own-origin | self-pay | swap | ✅ built |
| 2 | EVM/Base | own-origin | sponsored | swap | ✅ built |
| 3 | EVM/Base | own-origin | self-pay + sponsored | nft mint | ✅ built |
| 4 | EVM/Base | shared-origin | self-pay + sponsored | swap + mint | ✅ built |
| 5 | Solana | own-origin | self-pay + sponsored | swap + mint | ✅ built (Gap B) |
| 6 | Solana | shared-origin | self-pay + sponsored | swap + mint | ✅ built (Gap B) |

Phase labels used below: **IO** = network round-trip, **key** = passkey live, **pure** = neither.
The invariant across every journey: *all IO happens outside the single key phase — the key is never
live across a network round-trip.*

---

## Journey 1 — Base · own-origin · self-pay · swap (approve + swap)

**(a) Dev code** — Surface 2 sets up + authenticates; Surface 1 sends with stock wagmi:

```ts
// config: rpId set (in-code signing); no paymaster/bundler needed (self-pay).
// Surface 2 (once): <AvokProvider client={client}>; user onboarded via useCreate/useLogin.
// Surface 1:
const provider = client.getEip1193Provider();
announceEip6963(provider, info);                       // wagmi discovers the connector

const { sendCalls } = useSendCalls();                  // stock wagmi
const approve = { to: USDC,   data: encodeFunctionData({ abi: erc20Abi,  functionName: "approve", args: [ROUTER, amountIn] }) };
const swap    = { to: ROUTER, data: encodeFunctionData({ abi: routerAbi, functionName: "swapExactTokensForTokens", args: [...] }) };
sendCalls({ calls: [approve, swap] });                 // no paymaster capability ⇒ self-pay
// track: useCallsStatus(id) → wallet_getCallsStatus
```

The dev passes **two logical calls**; the dev does **not** build `execute(MODE_BATCH)`. That
construction is the wallet's job (below) — which is what keeps the send 100% standard wagmi.

**(b) Internal path:**

```
PHASE 0  DEV/WAGMI          sendCalls({calls:[approve,swap]}) → provider.request("wallet_sendCalls",[{chainId,calls}])
PHASE 1  RESOLVE      [IO]  no capabilities.paymasterService ⇒ rail=self-pay.
                           engine.send([approve,swap],{chainId}) → leanResolve: delegation status + intent nonce
                           → ResolvedBatch{ rail:"self-pay", userCalls:[approve,swap], authorization? (if undelegated) }
PHASE 2  BUILD CALLDATA [pure]  buildSelfPayCalldata = encodeExecuteBatch([approve,swap]) = execute(MODE_BATCH,[..])
PHASE 3  CONSENT      [IO]  estimateNativeFee → "≈ 0.0004 ETH (estimated)"; shown in-page (Gap A=ii)
PHASE 4  SIGN        [key]  ONE gesture: connection.signSend({ tx:{ to:wallet, data:batchCalldata, type:"eip1559" },
                                                              authorization? })  // 7702 auth over txNonce+1 if undelegated
PHASE 5  SUBMIT       [IO]  viem sendRawTransaction → Receipt{ rail:"self-pay", status:"submitted", txHash }
PHASE 6  TRACK        [IO]  wallet_getCallsStatus → getReceiptStatus (viem getTransactionReceipt) → confirmed/failed
```

**(c) Redesign role + invariants:**
- **Avok provides:** provider (Surface 1), own-origin Connection (passkey/PRF in-page), calldata
  builder (`encodeExecuteBatch`/`buildSelfPayCalldata`), delegation resolve
  (`resolveBatch`/`isDelegatedTo`), viem RPC adapter. **Stock tooling:** `encodeFunctionData`,
  `useSendCalls`/`useCallsStatus`, the actual send + track.
- **Keepers exercised:** `encodeExecuteBatch`, `buildSelfPayCalldata`, `resolveBatch`, `selfPayFees`,
  `estimateNativeFee`, `getReceiptStatus`. **Not touched:** oracle (gone), bundler/paymaster
  (sponsored only), `toAvokSmartAccount` (sponsored only).
- **Invariants:** batch = `execute(MODE_BATCH)`, no contract change; key isolation (IO in 1/3/5/6,
  key only in 4); sign-what-you-saw via in-page consent (Gap A=ii).

---

## Journey 2 — Base · own-origin · sponsored · swap (approve + swap)

Same wallet, same batch — the **only** dev-facing change from Journey 1 is that the app has sponsor
infra configured and the send names a fee token. Under the hood the rail changes from a raw tx to a
4337 UserOp, but the **callData is the identical `execute(MODE_BATCH)`**.

**(a) Dev code** — the delta from Journey 1 is two lines:

```ts
// config now carries the OPERATOR's sponsor infra:
export const config = { rpId, rpcUrls, paymasterUrl: "https://pm.operator.com", bundlerUrl: "https://bundler.operator.com" };

// Surface 1 send — read the fee-token options, then name one in the paymaster capability:
const { data: caps } = useCapabilities();              // wagmi → wallet_getCapabilities → { <chain>: { paymasterService:{supported}, feeTokens } }
const { sendCalls }  = useSendCalls();
sendCalls({
  calls: [approve, swap],                              // SAME two calls as Journey 1
  capabilities: { paymasterService: { context: { token: USDC } } },   // ⇒ sponsored; fee token = USDC
});
// track: useCallsStatus(id)
```

Note the Avok nuance: the dapp names only the **fee token** (`context.token`). The paymaster/bundler
**URLs come from the operator's `config`**, not the dapp — the provider ignores a dapp-supplied
`paymasterService.url`.

**(b) Internal path** (differences from Journey 1 in **bold**):

```
PHASE 0  DEV/WAGMI          sendCalls({calls,capabilities:{paymasterService:{context:{token:USDC}}}}) → wallet_sendCalls
PHASE 1  RESOLVE      [IO]  **capabilities.paymasterService present ⇒ rail=sponsored, feeToken=USDC.**
                           **expose wallet as a viem smart account: toAvokSmartAccount (the 4337 seam).**
                           **read the EntryPoint v0.8 2D nonce (getNonce).**
PHASE 2  BUILD USEROP [IO]  callData = encodeExecuteBatch([approve,swap])  ← **SAME batch bytes as Journey 1**
                           **ERC-7677 handshake via viem paymaster client:**
                           **  getPaymasterStubData → estimateUserOperationGas → getPaymasterData**
                           **→ unsigned UserOp (gas + paymaster sponsorship filled), userOpHash, authorization? (undelegated)**
PHASE 3  CONSENT     [pure] **fee = the ERC-7677 paymaster quote, in USDC** (post-oracle: quote fields only, no USD
                           conversion; a single-token paymaster returns no amount ⇒ disclose none). Shown in-page (Gap A=ii).
PHASE 4  SIGN        [key]  ONE gesture: **connection.signUserOp({ userOp, chainId, authorization? })**
                           **→ { signature, authorization }  (BOTH from the one passkey gesture)**
                           **attach signature + (if undelegated) the REAL 7702 authorization to op.**
PHASE 5  SUBMIT       [IO]  **viem bundlerClient.sendUserOperation(op) → id = userOpHash**
                           Receipt{ rail:"sponsored", status:"pending", id:userOpHash }
PHASE 6  TRACK        [IO]  **viem bundlerClient.getUserOperationReceipt(userOpHash) → confirmed/failed + real txHash**
```

**Self-pay (J1) vs sponsored (J2) at a glance:**

| | Self-pay (J1) | Sponsored (J2) |
|---|---|---|
| rail trigger | no fee token | fee token (`paymasterService`) |
| batch calldata | `execute(MODE_BATCH)` as a raw tx | `execute(MODE_BATCH)` as `UserOp.callData` (**identical bytes**) |
| wallet exposed as | EOA self-call | viem smart account (`toAvokSmartAccount`) |
| 7702 authorization | tx `authorizationList` (via `signSend`) | `UserOp.authorization` (via `signUserOp`) |
| the one gesture | `connection.signSend` | `connection.signUserOp` (returns sig **+** auth) |
| submit | viem `sendRawTransaction` | viem `bundlerClient.sendUserOperation` |
| receipt id | txHash | userOpHash (**not** a txHash until included) |
| fee shown | native gas estimate (ETH) | paymaster quote (USDC) |
| track | `getTransactionReceipt` | `getUserOperationReceipt` |
| who pays gas | user, in native | paymaster; user repays in the fee token (+ any paymaster premium, not in the quote) |

**(c) Redesign role + invariants:**
- **Avok provides:** provider, own-origin Connection, the **same** batch builder (`encodeExecuteBatch`),
  **`toAvokSmartAccount`** (the 4337 seam), and the **manual 7702-authorization + single-gesture
  orchestration**. **Stock tooling:** viem `createBundlerClient` (submit + userOp receipt),
  `createPaymasterClient` (ERC-7677 handshake), `estimateUserOperationGas`. `permissionless` is the
  **BYO external alternative** over the same `toAvokSmartAccount` seam — not an Avok dependency.
- **Stage 2 changes exercised here:** delete the custom `bundler.ts` / `paymaster-7677.ts` (→ viem's
  bundler/paymaster clients); re-express `prepareFrontedUserOp` over viem's paymaster/bundler
  primitives; the sponsored fee comes from the paymaster quote (oracle deleted in Stage 1).
- **Invariants (and Stage 2's real risk):**
  - callData is the **same** `execute(MODE_BATCH)` as self-pay — the "already batches" claim holds on
    both rails.
  - **The undelegated first sponsored send's 7702 authorization is attached to the UserOp and produced
    by the SAME gesture as the userOpHash signature.** viem's built-in account-authorization needs a
    `PrivateKeyAccount` and cannot express Avok's passkey signer — so this stays a **manual** Avok
    orchestration even after moving onto viem's bundler/paymaster clients. This is the seam most at
    risk of regressing in Stage 2.
  - sign-what-you-saw: the prepared op's fee is shown before the gesture, and the **exact** prepared
    op is the one signed (the reused-`SimulationResult` path), never a fresh estimate.
  - key isolation: all IO (nonce, 7677 handshake, gas, paymaster) is in phases 1–2, before the
    phase-4 gesture; submission is phase 5.
  - fee display = paymaster quote only (no USD oracle); single-token paymaster ⇒ no amount.

---

## Journey 3 — Base · own-origin · nft mint (self-pay + sponsored)

The single-call variant of 1/2 — it confirms the path generalizes off the batch.

**(a) Dev code** — one call instead of two; a non-zero `value` (the mint price):

```ts
const mint = { to: NFT, value: mintPrice, data: encodeFunctionData({ abi: nftAbi, functionName: "mint", args: [qty] }) };
sendCalls({ calls: [mint], ...capability? });   // user picks the rail exactly as J1/J2
```

**(b) Internal path:** identical to Journey 1 (self-pay) or Journey 2 (sponsored), with `userCalls =
[mint]`. `encodeExecuteBatch([mint])` still wraps it in `execute(MODE_BATCH)` — a **batch of one** —
and the call's non-zero `value` flows through the batch. Nothing else differs.

**(c) What it proves:** the calldata builder handles `n = 1..N` calls identically, and both rails
work regardless of call count or `value`. The only variables from J1/J2 are the call count and a
non-zero `value`.

**Framing decision (mirrors Gap B's "meet devs where they are"):** a single call is reachable **two
ways** — legacy `useSendTransaction` (`eth_sendTransaction`, which the provider wraps into a 1-call
`wallet_sendCalls`, so a dev's existing single-tx code needs *zero rewrite* against an Avok wallet),
or `useSendCalls`. **But the legacy path is self-pay-single-call ONLY:** `eth_sendTransaction` has no
`capabilities` field (no sponsorship) and is one call (no atomic batch). So a **batch** (swap) or
**anything sponsored** *must* use `useSendCalls`. Support both; demos/journeys lead with `useSendCalls`
for the full story; legacy is documented as the zero-rewrite self-pay-single-call path. This is the
exact EVM analogue of Gap B's stock-wallet-adapter (self-pay) vs `client.solana` (richer) split.

---

## Journey 4 — Base · shared-origin · swap + mint (self-pay + sponsored)

The piggybacking dapp: **Surface 1 only**, no Surface 2. Config sets `authOrigin` (popup), not `rpId`.
The send code is **identical to own-origin** — that identity is the whole point of the vision.

**(a) Dev code:**

```ts
// config: authOrigin set (popup signing), NOT rpId. The dapp MAY set its OWN paymasterUrl/bundlerUrl to sponsor.
const connection = createSharedOriginConnection({ authOrigin: config.authOrigin, channel });
const client = createAvokClient({ connection, rpcUrls, paymasterUrl?, bundlerUrl? });
const provider = client.getEip1193Provider();
announceEip6963(provider, info);
// eth_requestAccounts → connection.continue() → opens the auth-origin popup to CONNECT to an existing wallet
// then send EXACTLY as own-origin (swap batch or mint), user-driven rail:
sendCalls({ calls: [approve, swap], ...capability? });
```

No Surface 2: the dapp never creates or manages the wallet — it connects to one that already exists,
through the popup.

**(b) Internal path** — phases 1–3 and 5–6 run in the **dapp page** (the SendEngine, with the
shared-origin connection); only **phase 4 (SIGN)** crosses the origin boundary into the popup:

```
PHASE 0–3   [dapp page]  same as J1/J2: resolve rail, build execute(MODE_BATCH) / UserOp, 7677 handshake (all IO).
PHASE 4  SIGN [popup]    connection.signSend / signUserOp → @avokjs/shared-origin channel → window.open(authOrigin/sign)
                         → postMessage the SignConsentRequest { tx | userOp, authorization? } IN
                         → popup DECODES the request → renders consent + fee (the SAME union it signs — cannot drift)
                         → ONE passkey gesture (withDiscoveredKeys): key rebuilt from PRF INSIDE the popup
                         → signs (tx; or RECOMPUTES the userOpHash from supplied fields and signs it raw; 7702 auth from
                           the same gesture)
                         → postMessage only the SIGNATURE back — the key never leaves the popup
PHASE 5–6   [dapp page]  submit (viem sendRawTransaction / bundlerClient.sendUserOperation) + track — same as J1/J2.
```

**(c) Key facts + invariants:**
- **Consent lives in the popup** (Gap A=ii, shared-origin half). The popup decodes the *same*
  `SignConsentRequest` union it signs (`perform-sign.ts` dispatches the same union the consent screen
  decodes), so shown ≡ signed across the boundary. For `signUserOp` it **recomputes the userOpHash
  from the supplied fields** — never trusts a caller-supplied hash.
- **Key isolation across origins:** the key is reconstructed from PRF only inside the popup and
  discarded; only the signature crosses back.
- **Custody and sponsorship are decoupled.** The auth-origin operator provides **custody** (popup
  signing). **Sponsorship** (gas) is whoever configures `paymasterUrl`/`bundlerUrl` in the client
  that runs the SendEngine — i.e. the **dapp's own config** (BYO, operator-agnostic per the vision).
  The user still picks the fee token, validated against the target chain's registry in the dapp-page
  engine. So "the paymaster URL is the operator's config" (Journey 2) generalizes to "the config of
  whoever runs the SendEngine" — the app in own-origin, the dapp in shared-origin.
  - **Confirmed boundary:** an **operator cannot sponsor a shared-origin send** — there is no
    operator-side IO in this flow (the SendEngine + 7677 handshake run in the dapp page). Operators
    sponsor **only on their own-origin** app, where they run the SendEngine. For shared-origin: the
    dapp sponsors (BYO paymaster) or the send is self-pay. Moving sponsorship IO into the
    popup/auth-origin is explicitly **out of scope** for this redesign.
  - Sign-what-you-saw survives the split: the dapp builds the sponsored UserOp, but the **user still
    sees + consents to the fee in the popup** before signing (the popup renders consent from the same
    UserOp it signs), so "someone else chose the paymaster" never means "the user didn't see what they
    repay."
- **Redesign:** the popup ceremony + its consent decode are explicitly **out of scope** ("do not
  touch"). Stage 4 renames `fronted`→`sponsored` in the consent copy (`auth-origin/consent-display`).
  The dapp-page IO path is the same thinned engine as J1/J2.

---

## Journey 5 — Solana · own-origin · swap + mint (self-pay + sponsored) — **Gap B**

Solana breaks the symmetry: self-pay rides stock tooling, but **sponsored has no standard slot**.

**(a) Dev code:**
- **Self-pay** — Surface 1 via the Wallet Standard + `@solana/kit`. The dapp builds instructions
  (a swap = many instructions; a mint = its instruction set), and the Avok Solana wallet
  (`registerAvokSolanaWallet` → `@solana/wallet-adapter`) signs + sends:
  ```ts
  const ix = [...swapInstructions];          // @solana/kit / program clients
  await walletAdapter.sendTransaction(tx);   // stock wallet-adapter
  ```
- **Sponsored (Kora)** — **there is no `paymasterService` in the Wallet Standard**, so the dapp
  cannot request sponsorship or name a fee token through stock tooling. It uses the **Avok-specific**
  `client.solana` path:
  ```ts
  const ix = await client.solana.buildSplTransfer({ mint, to, amount, cluster, feeToken });   // Avok API
  const sim = await client.solana.simulate(ix, { cluster, feeToken });                         // fee = Kora quote
  await client.solana.send(sim, { cluster, feeToken });
  ```

**(b) Internal path (sponsored):** `client.solana.assemble` asks Kora `getPayerSigner` → builds the
message with **Kora as fee payer** → probes it → `buildKoraFeePayment` returns the **Kora quote** +
the fee instruction → prepends the fee instruction → the user signs **only their authority slot**
(`partiallySignTransactionMessageWithSigners`, one gesture, in-page) → **Kora co-signs as fee payer
and submits** (`signAndSendTransaction`), handing back a real signature. Fee display = the Kora quote
(already oracle-free — `priceSolanaFee` was removed in the prior relayer cleanup). Self-pay: the user
signs fully and `rpc.sendTransaction` broadcasts.

**(c) Gap B in full:** Solana **sponsored** cannot be expressed through `@solana/wallet-adapter` —
so it stays an explicit **Avok-namespace** API (`client.solana`), the one send in the whole matrix
that isn't stock tooling. **Decision needed:** accept Solana-sponsored as an Avok API, or wrap it
behind a Wallet-Standard *custom feature* (`avok:sponsoredSend`) so the dapp still goes through the
adapter? Redesign impact: **Stage 3 is mostly verification** — the Solana engine is already on
`@solana/kit` + Kora with no oracle; Stage 4 renames `fronted`→`sponsored`.

---

## Journey 6 — Solana · shared-origin · swap + mint (self-pay + sponsored) — **Gap B**

Journey 5's paths, with the sign gesture crossing into the popup — and the EVM/Solana asymmetry at
its widest.

**(a) Dev code:** same as Journey 5 (self-pay via Wallet Standard; sponsored via `client.solana`),
but built on a `createSharedOriginConnection`. The connection's `signSolanaTransaction` /
`signSolanaMessage` route the **sign gesture** to the popup (`perform-sign.ts` `signSolanaTransaction`
signs the supplied message bytes inside the popup and returns only the signature).

**(b) Internal path:** the message assembly + Kora orchestration run **app-side** (`client.solana`,
dapp page); only the passkey signature crosses to the popup. Self-pay: Wallet-Standard sign via the
popup, then broadcast app-side via kit. Sponsored: `client.solana` assembles + prices via Kora
app-side, the popup produces the authority signature, Kora co-signs + submits.

**(c) The asymmetry, stated plainly:** EVM shared-origin sponsored goes through the **provider**
(`wallet_sendCalls` + `paymasterService`), so the dapp is on 100% stock tooling. Solana shared-origin
sponsored has **no such standard slot**, so it runs through `client.solana` + the popup sign gesture.
Gap B is the same root cause as Journey 5, widest here because even the *send* (not just the fee
choice) is Avok-namespace rather than Wallet-Standard. Same open decision as Journey 5.

---

## Cross-journey summary — what the redesign must preserve

| Concern | EVM own | EVM shared | Solana own | Solana shared |
|---|---|---|---|---|
| Send surface | provider (stock wagmi) | provider (stock wagmi) | Wallet Std (self-pay) / **Avok `client.solana`** (sponsored) | Wallet Std + popup (self-pay) / **Avok `client.solana`** + popup (sponsored) |
| Batch | `execute(MODE_BATCH)` | `execute(MODE_BATCH)` | native multi-instruction | native multi-instruction |
| Where consent+fee shown | in-page (Avok) | popup | in-page (Avok) | popup |
| Where the key lives | in-page | popup only | in-page | popup only |
| Sponsored driver | viem AA (Stage 2) | viem AA (Stage 2) | Kora (kept) | Kora (kept) |
| Stock-tooling sponsored? | ✅ (`paymasterService`) | ✅ (`paymasterService`) | ❌ **Gap B** | ❌ **Gap B** |

**Open decisions surfaced by the journeys:**
- **Gap A — RESOLVED (ii):** Avok's connection owns consent+fee (in-page own-origin / popup
  shared-origin); the dapp never produces a fee number.
- **Gap B — RESOLVED (both routable; dev picks):** Solana self-pay is reachable via stock Wallet
  Standard (zero-rewrite) *and* `client.solana`; Solana sponsored is `client.solana` + Kora only (no
  fake custom feature). Ecosystem limitation, not an Avok shortcut. Stage 3 keeps Kora as-is; the one
  documented exception to "send with stock tooling."
