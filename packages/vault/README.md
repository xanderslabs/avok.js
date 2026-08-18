# @avokjs/vault

Build and serve the hardened Avok Vault page.

The Vault is one self-contained HTML file you deploy at an origin you choose — the `originPoint` an
app configures. Every Avok signing operation, plus device and guardian management, opens it in a
popup. Your app never calls WebAuthn, never sees PRF output, and never holds a key.

This package is build tooling. It is not installed by apps that use the SDK, which is why it is
separate from `@avokjs/core`.

## Quick start

```bash
npx @avokjs/vault init     # write avok-origin.config.json
npx @avokjs/vault build    # emit vault-dist/
npx @avokjs/vault dev      # serve vault-dist/ locally with the production headers
```

Deploy `vault-dist/` as a static site, then:

```bash
npx @avokjs/vault check https://vault.example1.com
```

## The headers are not optional

`build` writes `vault-dist/_headers` for Netlify and Cloudflare Pages, and
`vault-dist/csp-headers.txt` for every other host. **If your host does not send these, the page still
works and none of its hardening applies, and nothing will tell you.** That is what `check` is for.
Run it after every deploy.

This is not a theoretical risk. An earlier version of this build emitted its header rule for the path
`/index` while the page was served at `/`, so the rule matched no request and the policy was never
applied to anything. The page worked perfectly the whole time.

One header must stay absent: `Cross-Origin-Opener-Policy`. It severs `window.opener`, and the popup's
only route back to your app is through that relationship, so signing fails after the user has already
read the screen and approved. `check` flags it if a host or a proxy adds one.

## Two routes, two header sets

The Vault serves one page, but `build` writes header rules for two paths. The root path (the signing
popup) keeps the set above, with COOP absent for the reason just given. The `/recover` path (the same
page, reached by direct navigation) additionally gets `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` — a cross-origin-isolated context, which identity
recovery's threaded-WASM proving needs. This is safe on the recovery route specifically because it has
no `window.opener` to sever (it was never opened as a popup) and no external resource for COEP to
block (the page loads nothing but itself). `check` fetches both paths and fails if either is wrong:
COOP present on the root path, or COOP/COEP missing on `/recover`.

## The RPC set is pinned into the CSP

`connect-src` is set to exactly the RPC endpoints your configured `chains` resolve to — nothing else
this page could ever fetch. The Vault reads chain state itself (batch simulation for the consent
screen, guardian/recovery state) against these endpoints and no others; `build` refuses to emit a
policy with no chains configured, and `check` flags a deployed policy that still says `connect-src
'none'` as stale.

## Choosing your RP-ID

`init` defaults the RP-ID to your Vault's own host, which is the tightest scope WebAuthn allows.

**This choice is the wallet.** The signing key is derived from the passkey's PRF, and the passkey is
scoped to the RP-ID, so changing it later gives every user a different account with a different
address. Decide once.

If you already have passkeys created under a broader RP-ID, pin that historical value instead, or
your existing users land in an empty wallet. `build` refuses an RP-ID that is neither your Vault's
host nor a registrable domain suffix of it, because WebAuthn would refuse it at runtime and the
symptom there is a wallet that cannot be found.

## What is in `vault-dist/`

| File | Purpose |
|---|---|
| `index.html` | The whole Vault. All JavaScript and CSS inlined, your config baked in |
| `_headers` | Netlify and Cloudflare Pages header config |
| `csp-headers.txt` | The same policy for hosts that read headers from elsewhere |

The page fetches nothing except its own pinned RPC set at runtime. No CDN, no fonts, no analytics, no
image host, no third-party call of any kind. That is what lets its CSP set `default-src 'none'`
honestly, and `build` fails rather than emitting a page that would break that claim.

## Configuration

`avok-origin.config.json`, written by `init` and read by `build`:

| Key | Required | Meaning |
|---|---|---|
| `rpId` | yes | Your pinned WebAuthn RP-ID. See above |
| `vaultOrigin` | yes | Where the Vault is deployed, https except on localhost |
| `chains` | yes | Registry chain names (e.g. `["base", "ethereum"]`) this Vault serves. Pins `connect-src` |
| `rpcOverrides` | no | Per-chain RPC URL, keyed by the same names as `chains`. Unset chains use the registry default |
| `branding.operatorName` | no | Shown to users. Defaults to your `rpId`, never to "Avok" |
| `managementUrl` | no | Your management app, surfaced to apps that borrow the wallet |
