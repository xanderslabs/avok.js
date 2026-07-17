# @avokjs/auth-origin

The **auth-origin popup template** — the pages that let a dapp which is *not* your relying party use a
passkey wallet registered to your relying party.

It is **not a service.** It is two static HTML pages (`authorize`, `sign`) that you build with your
config baked in and host on any static host. **No server, no OIDC, no tokens, no session, no secret.**
Clone it and own it.

```sh
# 1. edit avok-origin.config.json  (your rpId + authOrigin — see below)
# 2. build
pnpm --filter @avokjs/auth-origin build:app
# 3. host app-inlined/ and apply app-inlined/csp-headers.txt
```

That is the whole deployment. `app-inlined/` contains `authorize.html`, `sign.html`,
`csp-headers.txt`, and a `_headers` drop-in for Netlify/Cloudflare-style hosts.

---

## What it does

A dapp opens `https://<your-auth-origin>/authorize` in a popup. The user runs **one passkey gesture**;
the popup reads the wallet and `postMessage`s the account back to the origin that opened it. Later the
dapp opens `/sign`, the popup renders what is being signed, and — on approve — **one more gesture**
signs it *in the browser* and posts the signature back.

**The origin never sees a key.** `K = HKDF(PRF(credential, rpId))` is derived in the popup, used, and
discarded. There is nothing to custody — and now nothing to run.

## It is open, MetaMask-style

Any origin may open these popups. There is no client registration, no allowlist, and no gate on *which*
dapp a user may reach — **the consent screen is the gate**: the user reads what they are signing and
decides. The popup replies only to the origin that opened it (`event.origin`, browser-guaranteed),
never to `"*"`.

That is the whole reason the popup exists. Your own domains (≤5 registrable labels) should use a static
`/.well-known/webauthn` (ROR) file instead — no popup, no server. **The popup is for the unbounded
third-party case ROR cannot cover.**

## 🔑 Choosing your rpId — the most irreversible decision in your product

`K = HKDF(PRF(credential, rpId))`. **The rpId is an input to the wallet key.** Change it and every user
gets a *different wallet* — their funds do not move, they simply become unreachable from your app.

So:

- Pick a domain you will **never** give up. Usually the apex (`example.com`), not a subdomain you might
  later restructure.
- **Never derive it from a URL or hostname.** The build refuses to emit if `rpId` is unset or still the
  shipped placeholder, because an inferred rpId is a wallet-drain defect, not a convenience gap.
- The popup may be *hosted* anywhere (`wallet.example.com`); the rpId is set explicitly and pinned.

## An XSS on this origin is a wallet drain

This origin can run the WebAuthn ceremony under your rpId, so a script injected into it can derive user
keys. The pages therefore ship with:

- **hash-pinned scripts** (`script-src 'sha256-…'`); no `unsafe-inline`, no `unsafe-eval`, no
  `strict-dynamic`;
- **Trusted Types enforced** (`require-trusted-types-for 'script'`), so a DOM script-injection sink
  throws rather than running;
- `default-src 'none'`, `connect-src 'none'` (the pages make **no network call at all**),
  `frame-ancestors 'none'`, `form-action 'none'`, `object-src 'none'`, `base-uri 'none'`.

The policy used a fresh **per-response nonce** when a server rendered these pages. A static host cannot
mint one per response — and a *frozen* nonce is as weak as `unsafe-inline`, since an attacker learns it
once. So the build hashes the exact bytes it ships instead: equally strong, because nobody can forge the
hash of a script they did not write. **The build emits the policy; you must actually serve it.**

If you fork the pages, keep all of it — and re-run the build so the hashes match what you ship. A stale
hash is a page that silently does not run.

## What is NOT here

- **Related Origin Requests (`/.well-known/webauthn`).** That is your *own-origin* mechanism, and it must
  sit at your **rpId root**, which is usually not this host. Put the static JSON there. The
  `passkey-access-vault` standard carries the tooling (`reference/src/related-origins.ts`, `vectors/`).
- **A paymaster.** Fronted sends use any ERC-7677 paymaster + bundler, or Kora on Solana. Avok ships none.
- **Anything that stores a user.** No database, no session, no key.

## Config

`avok-origin.config.json`, baked in at build time:

| Field | Required | Meaning |
|---|---|---|
| `rpId` | **yes** | Your **pinned** RP-ID. Read the section above before choosing. |
| `authOrigin` | **yes** | Where you host these pages, e.g. `https://wallet.example.com`. https, except true localhost. |
| `branding.operatorName` | no | Shown in the passkey prompt and the popup. |
| `anchorChainId` | no | CAIP-2 anchor chain. Defaults to `eip155:10` (Optimism). |
| `managementUrl` | no | Your own-origin app, where users create/manage/back up their wallet. |
| `paymasterUrl`, `feeToken` | no | Passthrough for fronted sends. |

## Verification

```sh
pnpm --filter @avokjs/auth-origin test
```

Guards worth knowing about, because they encode decisions rather than behaviour: the popup sources
contain **no script-injection sink** (which is what licenses enforcing Trusted Types); the sign popup
**never enables Approve on a failed decode** (it once rendered an error body as the consent summary and
still offered Approve — and Approve *worked*, because signing never consults the origin); the emitted
CSP hashes are recomputed from the **shipped** HTML; and the pages make no `fetch` at all.
