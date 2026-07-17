# VERIFICATION.md — @avokjs/vanilla

## What unit tests cover

Unit tests (`test/vanilla.test.ts`, 7 tests, all green) verify the **wiring** only:

| Test | What it proves |
|------|---------------|
| `createOwnOriginConnection` returns Connection verbs | `create`, `continue`, `import`, `export`, `logout`, `account`, `status`, `signMessage`, `canExport`, `canImport` all present |
| Custom storage override accepted | Storage injection path wired correctly |
| `createSharedOriginConnection` is `AsyncFunction` | Bundle-purity guard: dynamic-import boundary is real; bundlers can code-split the shared-origin transport |
| `createSharedOriginConnection` matches async prototype | Same as above, different assertion surface |
| `webStorage` round-trips (memory path in test env) | get/set/remove semantics correct |
| `webStorage` returns null for unknown key | Null-return contract holds |
| `webStorage` falls back to memory when localStorage absent | Node.js 22 / SSR / locked-storage guard works |

> **Note on the localStorage round-trip test**: the Node.js 22 test runner exposes a
> stub `globalThis.localStorage` that lacks Storage-prototype methods. `webStorage()`
> detects this via the `typeof setItem === "function"` guard and falls back to memory.
> The test therefore exercises the **memory path** (which is the correct behaviour in
> Node/SSR). The real **localStorage path** is device-gated (see below).

---

## Device-gated: what requires a real browser

The following cannot be exercised in unit tests:

### Real WebAuthn (own-origin connection)

`createOwnOriginConnection({ rpId })` builds a `WebAuthnPasskeyAdapter` that calls
`navigator.credentials.create` and `navigator.credentials.get`. These require:

- A browser with a platform authenticator (Touch ID / Face ID / Windows Hello)
- A page served over HTTPS (or `localhost` for dev)
- The rpId matching the origin

**To verify manually:**
1. Serve a page that calls `createOwnOriginConnection({ rpId: "localhost" }).create()`
2. Browser prompts for Touch ID / Face ID / Windows Hello
3. Wallet is created; `conn.account()` returns an Ethereum address
4. Refresh and call `conn.continue()` — same address recovered from the passkey

### localStorage persistence (web)

`webStorage()` uses `localStorage` when `window.localStorage.setItem` is callable
(real browser). To verify manually:
1. Call `createOwnOriginConnection({ rpId: "…" })` in a browser
2. Open DevTools → Application → Local Storage
3. Confirm `avok:identity` key is written after `conn.create()`
4. After page refresh, `conn.account()` should return the stored address via `webStorage`

### Real shared-origin popup (`createSharedOriginConnection`)

`createSharedOriginConnection({ authOrigin, redirectUri })` opens a cross-origin popup
via `createWebChannel` (from `@avokjs/shared-origin`). This requires:

- An auth origin hosting the static `@avokjs/auth-origin` pages (nothing to run — build + serve the files)
- A real browser that allows popups for the origin
- HTTPS (or localhost with matching ports)

**To verify manually:**
1. Serve the built `@avokjs/auth-origin` pages at `https://localhost:3000`
2. Call `await createSharedOriginConnection({ authOrigin: "https://localhost:3000", redirectUri: "https://localhost:5173/callback" })`
3. A popup opens, user authenticates, popup closes
4. `conn.account()` returns the shared-origin wallet address

### Bundle-purity (lazy shared-origin)

To confirm an own-origin-only app never pulls the shared-origin chunk:
1. Build a minimal app that only calls `createOwnOriginConnection`
2. Inspect the output chunks — `@avokjs/shared-origin` must NOT appear in the initial
   chunk; it should only appear in a lazy chunk (or not at all if never called)
