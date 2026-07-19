import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The security invariant of the whole auth-popup: the key-reconstruction origin is a fully-inlined,
 * CSP-locked static page that never shares with an external script. An XSS or a stray external script
 * on this origin is a WALLET DRAIN (it can run the WebAuthn ceremony, and K = HKDF(PRF(credential,
 * rpId))). This runs as the last step of `emit:auth-page`, so a build that would weaken the page fails
 * loud rather than shipping.
 */
const OUT = join(new URL("../", import.meta.url).pathname, "app-inlined");
const html = readFileSync(join(OUT, "index.html"), "utf8");
const csp = readFileSync(join(OUT, "csp-headers.txt"), "utf8");

const fail = (m) => {
  console.error(`AUTH-PAGE INVARIANT VIOLATED: ${m}`);
  process.exit(1);
};

// 1. Everything is inlined — no external script/style/asset the origin does not itself serve inline.
if (/<script[^>]*\bsrc=/.test(html)) fail("index.html has an external <script src=…>");
if (/<link[^>]*\brel=["']stylesheet["']/.test(html)) fail("index.html has an external stylesheet <link>");
if (/\b(?:src|href)=["']https?:\/\//.test(html)) fail("index.html references an external http(s) URL");

// 2. The CSP is hash-locked and closed — no 'unsafe-inline', and the page talks to nothing.
if (!/default-src 'none'/.test(csp)) fail("CSP missing default-src 'none'");
if (!/script-src [^;]*'sha256-/.test(csp)) fail("CSP script-src is not sha256-pinned");
if (/'unsafe-inline'/.test(csp)) fail("CSP contains 'unsafe-inline'");
if (!/connect-src 'none'/.test(csp)) fail("CSP missing connect-src 'none' (the page must make no network call)");

console.log("auth-page invariant OK: inlined + CSP hash-locked + connect-src none");
