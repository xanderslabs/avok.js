# auth-origin — VERIFICATION

What is proven by tests, what can only be proven on a real device, and what has actually been run on
one.

> **Rewritten 2026-07-13, corrected 2026-07-14.** The 07-13 pass removed `/import`, `/export` and
> `/add-device` and their handlers (`handleImport`, `handleExport`, …) — **none of which exist** — but
> left the *Un-pairing a device* section standing, and every claim in it was false too (see that
> section). A verification document that describes code the repository does not contain is worse than
> no document: it is a map of a building that was demolished. Every claim below, and every test
> citation, was re-checked against the source on 2026-07-14.

---

## What this origin is

A **use-only** shared-origin tunnel. It exists so a dapp that is **not** the RP can use a passkey wallet
registered to that RP. It does not create, import, export or manage wallets — that happens in the
operator's own first-party own-origin app.

What it actually serves:

```
NOTHING. It is two static HTML files.

  authorize.html   the connect popup   (one passkey gesture -> postMessage the account)
  sign.html        the sign popup      (decode in-bundle -> one gesture -> postMessage the signature)
```

#8 deleted the server: no OIDC discovery, no /jwks, no /token, no /userinfo, no
/authorize/{challenge,complete}, no /sign/consent, and no store. There are no subname voucher
routes either — name registration is out of scope for Avok, so no such backend exists here.
`/.well-known/webauthn` is own-origin's mechanism and belongs at your rpId ROOT, not here.

**There is no server-side signing endpoint, and there never may be.** Signing happens in the browser,
inside the popup, under the passkey PRF: `K = HKDF(PRF(credential, rpId))`. The origin holds no wallet
key in any mode — and it holds no voucher key either: there are no subname voucher routes, because
name registration is out of scope for Avok.

**The origin persists nothing about anyone, because there is nothing to persist it with.** There is no
store of any kind — not `ClientStore`, not a session, not a token. The popup runs the passkey ceremony
and `postMessage`s the account back to the opener; the channel pins both the origin it opened and the
exact window it opened, which is what `state` and PKCE existed to provide for a redirect through the
address bar. Nothing travels through a URL, so there is no code to intercept and no token to mint.

---

## The two things only a device can prove

Everything else here is a unit test. These two are not, and no suite substitutes for them:

1. **The passkey gesture** — a real authenticator producing a real PRF output. The wallet key is
   derived from it; nothing else derives it.
2. **Cross-origin `postMessage` between a real popup and a real opener** — the popup boundary *is* the
   trust boundary, and a fake window cannot exercise it.

That is not a formality. **Every serious bug in the shared-origin path was invisible to a green test suite**
and appeared only in a browser:

| bug | why no test caught it |
|---|---|
| The authorize popup replied in a shape the client discriminated away — login could never complete | the reply crosses a `postMessage` boundary TypeScript cannot type |
| The sign request was posted to a popup that had not loaded, and was silently lost | `postMessage` does not queue for an unloaded document |
| `JSON.stringify` threw on a BigInt *before the fetch was issued* | transaction consent had never once been exercised end to end |
| The consent screen rendered every send as raw calldata | `decodeSignConsent` was correct; nothing tested the JSON hop into it |

Each is now pinned by a **source guard**, because a source guard is the only thing that can span those
boundaries.

---

## Live-verified on real hardware

Arc testnet (`eip155:5042002`), delegate `0xFED0fc93ec8914e169E1eBb0ffb8C8638f0Ff705` — deployed and
bytecode-verified by the founder (2026-07-14) after the CREATE2 re-pin, with the hardware retest re-run
green against it. Chrome/macOS + iPad, iCloud Keychain.

> **Superseded 2026-07-15.** After the passkey-access-vault Solidity moved into the CC0 standard
> (imported via git submodule), the implementation's embedded source-path metadata changed — moving
> its CREATE2 address to `0x792D10df3a1A1D3F6b8d928403A7F3370520dD45` (contract logic byte-identical).
> Re-deployed and hardware-verified against the new address.

> **Superseded again 2026-07-15.** The accessSlot/passkey vocabulary rename touched the standard's contract
> NatSpec, changing the embedded source metadata hash again and moving the CREATE2 address to
> `0xd7b1EC48B129fAd25e2bfEB65F188e408624B827` (contract logic still byte-identical; ERC-7201 storage
> root unchanged). Re-deployed and hardware-verified against the new address.

> **Superseded again 2026-07-15.** The dual-mode 7702+4337 rework added `validateUserOp` + an
> EntryPoint-gated execute and removed the bespoke `executeFronted`/`FrontedBatch` path — unlike the
> prior two moves this is a real bytecode/logic change, moving the CREATE2 address to
> `0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C` (ERC-7201 storage root `0xa4fa…0600` still unchanged; a
> StorageLayout forge test guards it). Re-deployed and hardware-verified against the new address.

(The prior delegate, `0xe6506905C7681a677d3A9c7c881Ae80D7661Dc12`, remains on chain; nothing points at
it.)

- Wallet create, logout, login.
- **Cross-device QR pairing**, including the on-chain slot write.
- **PRF carries across iCloud Keychain sync** (Mac/Chrome → iPad: same wallet).
- ENS **and** SNS resolve-and-send.
- **Shared-origin login, message signing, and a send through the sign popup** — the full stateless flow.
- **Trusted Types enforcing**, with no violation.
- The account picker no longer appears after the first sign-in.

**The fronted rail (gasless), both chains — verified 2026-07-13.** Both relayers were run with real
keys and a USDC send completed on each:

- **EVM paymaster** — fronted send, **fee paid in USDC**.
- **Solana relayer** — fronted SPL send, **fee paid in USDC**, to a recipient with **no existing
  token account**. That last detail matters: it is the only path that exercises **create-ATA rent
  fronting**, where the relayer's fee payer fronts the rent and re-prices it into the fee token.
  It fires only for a fresh recipient, so a send to an existing holder would have proved nothing about
  it.

The user pays in the fee token and holds no gas asset — which is the entire point of fronted.

---

## Security invariants, and where each is tested

### The wallet key

| Invariant | Test |
|---|---|
| The popups use the operator's **pinned** rpId — never one inferred from a URL. An inferred rpId derives a **different wallet**. | `app-render.test.ts` |
| The origin **refuses to construct** without an explicit rpId (`MissingRpIdError`). | `http.test.ts` |
| 🔴 **The passkey adapter refuses to construct without an rpId too.** It used to fall back to `window.location.hostname`, which is not an rpId (an origin on a subdomain asserts the APEX) and which makes the wallet a function of the URL — the same app on two hosts derives two different keys. | `wallet-core/test/rpid-must-be-pinned.test.ts` |
| The origin holds no wallet signer; there is no server-side signing endpoint. | by construction (`http.ts`) |

### Consent — the trust boundary of the shared-origin model

A dapp asks for a signature, and the only thing between the user and a malicious request is the popup
rendering it **truthfully**. Consent correctness is a security property, not a UX one.

| Invariant | Test |
|---|---|
| An Avok send is a call to the user's own wallet (ERC-7821 `execute`); consent **unwraps the batch** and shows recipient and amount, not raw calldata. | `consent-batch.test.ts` |
| Unwrapping never makes an *unknown* call look understood — a non-wallet call still renders as raw. | `consent-batch.test.ts` |
| BigInts survive the popup → origin JSON hop (`tx.value`, `gas`, fees). | `sign-consent-wire.test.ts` |
| **Approve is unreachable unless the request was decoded AND displayed.** A failed decode is terminal. | `app-render.test.ts` |
| A refusal is thrown, not cast through as a signature (a rejected tx used to resolve with `signature === undefined`). | `packages/network/test/session-expiry.test.ts` |

### The stateless origin

| Invariant | Test |
|---|---|
| 🔴 **The login proof commits to the PKCE `code_challenge`.** Without it, a captured proof replayed with the attacker's own `code_challenge` mints a code they can redeem — the victim's session, stolen, nothing forged. **This is what makes deleting the challenge store safe. It is not optional.** | `code-challenge-binding.test.ts`, `mint.test.ts`, `solana-pop.test.ts` |
| The subname voucher proof commits to the **label** — it never did, so a captured proof could mint a name the user never asked for, to their own address. | `code-challenge-binding.test.ts`, `subname-voucher.test.ts` |
| 🔴 **PKCE is enforced at `/token`** — the only thing making a replayed code useless, now that codes are not single-use. | `http.test.ts` |
| 🔴 The JWT `typ` is **required**, so a code cannot be presented as an access token (skipping `/token` and its PKCE check). | `jwt-tokens.test.ts` |
| The challenge is a valid SIWE nonce (alphanumeric, ≥8). viem rejects anything else, so a wrong encoding breaks **every** login. | `challenge.test.ts` |
| The origin exposes **only** `ClientStore` — per-user state cannot return. | `store-memory.test.ts` |
| A token minted by one instance is accepted by a **different** instance (restart survival). | `http.test.ts` |
| The signing key must be durable; an ephemeral one must be opted into out loud. | `keys.test.ts` |

> The three rows marked 🔴 are the guards the whole stateless design rests on. **Two of them were found
> completely untested by mutation testing** — deleting either left the entire suite green. If you are
> ever tempted to weaken a test in this package, weaken any other one first.

### Related origins — the key-access control list

`/.well-known/webauthn` lists origins that may run the WebAuthn ceremony under this rpId. Every one of
them can therefore compute `K = HKDF(PRF(credential, rpId))` — **the wallet key**. Not "can sign the
user in": can derive their private keys and move their funds. It is a list of keys to the wallet.

It was previously an unvalidated `string[]` echoed straight out of the endpoint. It is now validated at
construction — a bad ACL makes the origin **refuse to start** rather than be served.

| Invariant | Test |
|---|---|
| Unset → `404`. Publishing no ACL is the safe default. | `http.test.ts` |
| 🔴 **Refuses to construct when the ACL is set on an origin browsers will never fetch.** Browsers read `https://<rpId>/.well-known/webauthn` — the rpId **root**. Mounted on a subdomain (`auth.qudi.fi`, the normal deployment), the endpoint answers a host nobody asks: the operator sees a 200, believes it works, and ships — and it silently does nothing. | `related-origins.test.ts`, `http.test.ts` |
| Rejects wildcards. There is no such thing as a wildcard key. | `related-origins.test.ts` |
| Rejects non-https (except `http://localhost`). A plaintext origin can be MITM'd into running the ceremony. | `related-origins.test.ts` |
| Rejects anything that is not a bare origin — path, query, fragment, trailing slash. | `related-origins.test.ts` |
| Rejects empties and duplicates. A list you cannot read is a list you cannot audit. | `related-origins.test.ts` |
| Rejects more than **5 registrable domains** — browsers honour 5 and **ignore** the rest, so a longer list half-works, which is worse than failing. | `related-origins.test.ts` |
| 🔴 **Counts eTLD+1 with the public suffix list**, not "the last two labels". Under a multi-part suffix the naive rule collapsed six distinct `.co.uk` sites into ONE domain, so the cap above waved through exactly the truncated list it exists to reject. | `related-origins.test.ts` |

**Operator checklist before setting this in production:**
1. Mount the origin at the **rpId root**, or serve the file yourself at `https://<rpId>/.well-known/webauthn` and leave `relatedOrigins` unset here.
2. Every entry must be a domain **you own and control**, first-party, not a preview/CDN host someone else can claim.
3. Keep it under 5 registrable domains.
4. Treat a change to this list as a change to wallet custody, because it is.

### The popup boundary

| Invariant | Test |
|---|---|
| The popups reply in the channel's `kind`-discriminated shape. | `app-render.test.ts` |
| The sign popup announces `ready`, so the opener can re-send a request lost to an unloaded document. | `app-render.test.ts` |
| The sign popup constrains its assertion to the session's `credentialId` (no account picker), **with a fallback** if that credential is gone. | `app-render.test.ts` |
| `authorize` records the credential from the gesture it already performs — never a second prompt. | `app-render.test.ts` |
| A per-response CSP nonce; no `unsafe-inline`, no `unsafe-eval`. | `http.test.ts` |
| **Trusted Types are ENFORCED** (not report-only); the popup sources contain no script-injection sink; the built bundle contains no `eval` / `new Function`. | `app-render.test.ts` |
| `app-inlined/` is published — an npm-installed origin must be able to serve its popups. | `app-render.test.ts` |

---

## Removing an access slot: housekeeping, never revocation

> **This section was completely wrong until 2026-07-14.** It described a `removeBackupSlot` /
> `BackupSlot` / `activeBackupSlotCount` API that exists **zero times** in the contracts; it claimed
> slots cannot be enumerated (they are stored in a `bytes32[] slotIds` — an enumerable index); it
> claimed the package ships no removal verb and that `wallet-core/test/public-api.test.ts` guards
> against one (that test asserts the **opposite**: `removeAccessSlot` and `getAccessSlotIds` are
> exported, and no exported name may say "revoke"); and it called blob deletion *"genuine
> revocation"*. Removal is enumerable and aimable, and it is **not revocation**. Both halves of the
> old text were false.

An access slot can be removed. `removeAccessSlot(slotId)` deletes the slot's ciphertext from storage, drops it
from the enumerable index, and decrements the count. `getAccessSlotIds()` lists the access slots, so removal
can be **aimed** — and the roster names the domain that enrolled each one.

**Removing an access slot is CAPACITY MANAGEMENT, not a security control**, and no surface may imply otherwise.
`MAX_ACCESS_SLOTS` is 32; without removal a full wallet could never enrol another device. That is the
entire justification. Three things it cannot do:

1. **It cannot un-learn the key.** Every passkey must materialise `K` in memory to sign. "Never stored at
   rest" is not "never existed" — a passkey that has run once may have kept it.
2. **It cannot erase the blob.** The ciphertext was public **calldata**. It is in chain history
   forever, on every full node; deleting it from *storage* removes it from an `eth_call`, not from the
   world. Anyone who kept a copy and holds that passkey's PRF can still decrypt it.
3. **It cannot be aimed by the honest party alone.** Every passkey signs as the same `K`, so **any passkey
   can close any other** — including the one you are using to do the closing. The contract cannot tell
   the owner from an intruder, because to the key they are the same principal.

So: removing an access slot frees capacity. **If a device is compromised, move the funds to a new wallet** — on
both chains. Removal is not a substitute, and the demos say so on the Access screen before the user
enrols anything. There is deliberately **no `sweep()` primitive**; the compromise runbook is the
documented remedy.

## Known gaps

- **Native (React Native) channels are descoped.** `channels-native.ts` is unit-tested, the origin
  emits no native redirect, and the RN demos are out of scope.
- **`/.well-known/webauthn` is validated, but the production list is not yet chosen.** The ACL is
  hardened (see *Related origins* above); what remains is the operator decision of *which* origins go
  on it. That is a business decision, not a code gap.
- **Tokens cannot be revoked before they expire** (30 minutes). With nothing stored there is nothing to
  revoke against; the TTL is the blast radius. This is a small trade: a stolen access token **cannot
  sign** — every signature needs a passkey gesture on the user's own device — so it leaks public
  addresses and nothing else.
- **There is no "migrate to a new wallet" flow.** Moving funds is the only real remedy for a
  compromised device, and today the user does it by hand. A `sweep()` primitive was considered and
  **deliberately rejected** — it is a one-call drain of the wallet, available to every passkey, which is
  precisely the capability an attacker wants.
