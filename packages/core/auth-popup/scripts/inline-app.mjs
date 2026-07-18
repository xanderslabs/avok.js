import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * Fold each entry's JS+CSS into ONE self-contained HTML, bake the operator's config into it, and
 * emit the CSP that page must be served with.
 *
 * #8 moved config injection here from the origin's `render.ts`: there is no server to inject it per
 * request, so the operator bakes it at build time (clone-and-own, VISION §7).
 *
 * WHY HASHES AND NOT A NONCE. The server minted a FRESH nonce per response because "an XSS on this
 * origin is a WALLET DRAIN", and its own comment warned that a reused nonce is "as weak as
 * 'unsafe-inline'" — an attacker learns it once. A static page cannot mint per-response nonces, so
 * freezing one would be exactly that weakness. But once the config is baked the script BYTES are
 * fixed, so their sha256 is stable and CSP can admit them by hash — which is just as strong: an
 * attacker cannot forge the hash of a script they did not write.
 */

const ROOT = new URL("../", import.meta.url).pathname;
const DIST = join(ROOT, "app-dist");
const OUT = join(ROOT, "app-inlined");
const ENTRIES = ["authorize", "sign"];
const MODULE_OPEN = '<script type="module">';

// ── The operator's config ────────────────────────────────────────────────────────────────────
const raw = JSON.parse(readFileSync(join(ROOT, "avok-origin.config.json"), "utf8"));

// FAIL LOUD on a missing rpId. K = HKDF(PRF(credential, rpId)); an unset — or worse, an
// inferred-from-URL — rpId is a wallet-drain defect, not a convenience gap. The server refused to
// CONSTRUCT without one (assertRpId); this build refuses to EMIT without one. Same guarantee,
// earlier.
if (typeof raw.rpId !== "string" || raw.rpId.trim() === "" || raw.rpId === "wallet.example.com") {
  throw new Error(
    "avok-origin.config.json: rpId is required and must be YOUR pinned RP-ID (the placeholder " +
      '"wallet.example.com" is not a config). The rpId scopes the passkey PRF that IS the wallet ' +
      "key — pin it explicitly, never infer it from a URL or hostname.",
  );
}
if (typeof raw.authOrigin !== "string" || !raw.authOrigin.startsWith("https://")) {
  // http://localhost is fine in dev, but a shipped popup on plain http is a wallet drain.
  if (!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$|\/)/.test(String(raw.authOrigin))) {
    throw new Error(
      `avok-origin.config.json: authOrigin must be https (got ${JSON.stringify(raw.authOrigin)}). ` +
        "http is allowed only for true localhost during development.",
    );
  }
}

/** Mirrors src/app/branding.ts's resolveAppConfig — the shape the popup's readConfig() expects. */
const appConfig = {
  operatorName: raw.branding?.operatorName ?? "Avok",
  authOrigin: raw.authOrigin,
  rpId: raw.rpId,
  defaultChainId: Number(String(raw.anchorChainId ?? "eip155:10").replace("eip155:", "")),
  ...(raw.managementUrl ? { managementUrl: raw.managementUrl } : {}),
  ...(raw.paymasterUrl ? { paymasterUrl: raw.paymasterUrl } : {}),
  ...(raw.feeToken ? { feeToken: raw.feeToken } : {}),
};
if (!Number.isFinite(appConfig.defaultChainId)) {
  throw new Error(
    `avok-origin.config.json: cannot derive a numeric chainId from anchorChainId ${JSON.stringify(raw.anchorChainId)}`,
  );
}

// ── The CSP, copied verbatim from the deleted popupCsp() ─────────────────────────────────────
// Every directive and its reasoning is unchanged; only the script-src mechanism moved from
// per-response nonce to build-time hash. connect-src drops to 'none' because the popup's only
// fetch (POST /sign/consent) is gone — the decode is in-bundle.
function csp(hashes) {
  const pinned = hashes.map((h) => `'sha256-${h}'`).join(" ");
  return [
    "default-src 'none'",
    `script-src ${pinned}`,
    `style-src ${pinned}`,
    "connect-src 'none'",
    "img-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'allow-duplicates'",
  ].join("; ");
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("base64");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const headers = [];

for (const entry of ENTRIES) {
  let html = readFileSync(join(DIST, `${entry}.html`), "utf8");

  // Inline <script type="module" crossorigin src="/assets/x.js"></script>
  html = html.replace(/<script[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_m, src) => {
    const code = readFileSync(join(DIST, src.replace(/^\//, "")), "utf8");
    return `${MODULE_OPEN}${code}</script>`;
  });
  // Inline <link rel="stylesheet" href="/assets/x.css">
  html = html.replace(/<link[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g, (_m, href) => {
    const cssText = readFileSync(join(DIST, href.replace(/^\//, "")), "utf8");
    return `<style>${cssText}</style>`;
  });

  // Bake the config BEFORE the first module script, escaping `<` so a value can never close the
  // script early (ported from render.ts's injectConfig, which was tested for exactly this).
  const cfg = JSON.stringify(appConfig).replace(/</g, "\\u003c");
  const configTag = `<script>window.__AVOK_CONFIG__=${cfg}</script>`;
  const marker = html.indexOf(MODULE_OPEN);
  if (marker === -1) throw new Error(`${entry}.html has no module script to inject before`);
  html = html.slice(0, marker) + configTag + html.slice(marker);

  // Hash every inline script/style the page actually ships. Recomputed from the FINAL bytes — a
  // hash taken before the config was baked would admit a page that no longer exists.
  const inline = [
    ...[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]),
    ...[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]),
  ];
  const hashes = [...new Set(inline.map(sha256))];

  writeFileSync(join(OUT, `${entry}.html`), html);
  headers.push(`# /${entry}\ncontent-security-policy: ${csp(hashes)}`);
  console.log(`inlined ${entry}.html (${html.length} bytes, ${hashes.length} hashed inline blocks)`);
}

writeFileSync(join(OUT, "csp-headers.txt"), `${headers.join("\n\n")}\n`);

// A drop-in for Netlify/Cloudflare Pages-style static hosts. Other hosts (S3+CloudFront, nginx)
// read the same policy out of csp-headers.txt.
const netlify = ENTRIES.map((entry, i) => {
  const policy = headers[i].split("content-security-policy: ")[1];
  return `/${entry}\n  Content-Security-Policy: ${policy}`;
}).join("\n");
writeFileSync(join(OUT, "_headers"), `${netlify}\n`);

console.log(`emitted csp-headers.txt + _headers → ${OUT}`);
