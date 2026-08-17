import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { build as viteBuild } from "vite";
import { bakedAppConfig, parseVaultConfig, type VaultConfig } from "./config.js";
import { buildCsp, headersFileContent } from "./headers.js";

/** What a Vault build produces: the page, the policy that describes it, and the file a host reads. */
export interface BuiltVault {
  html: string;
  csp: string;
  headers: string;
}

export interface InlineArgs {
  /** The bundler's HTML, still referencing its assets by URL. */
  html: string;
  /** Every emitted asset, keyed by the path the HTML references it as, without a leading slash. */
  assets: Map<string, string>;
  config: VaultConfig;
}

const MODULE_OPEN = '<script type="module">';
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("base64");

function takeAsset(assets: Map<string, string>, ref: string): string {
  const key = ref.replace(/^\//, "");
  const body = assets.get(key);
  if (body === undefined) {
    // Silently leaving the reference in place would ship a page whose CSP forbids loading it: a
    // blank Vault, failing at the browser rather than at the build.
    throw new Error(`Vault build: the page references "${ref}" but the bundler emitted no such asset (${key}).`);
  }
  return body;
}

/**
 * Turn a bundled page into the single self-contained file the Vault ships, and compute the policy
 * that describes it.
 *
 * PURE. Everything IO-shaped is the caller's problem, which is what lets the security invariants
 * below be asserted directly on the result instead of on a build artifact that may not exist.
 *
 * ORDER MATTERS. The config is baked BEFORE the hashes are taken, because a hash computed over the
 * pre-config bytes would admit a page that no longer exists, and CSP would then reject the page's
 * own baked config.
 */
export function inlinePage({ html, assets, config }: InlineArgs): BuiltVault {
  let out = html;

  out = out.replace(/<script[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_m, src: string) => {
    return `${MODULE_OPEN}${takeAsset(assets, src)}</script>`;
  });
  out = out.replace(/<link[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g, (_m, href: string) => {
    return `<style>${takeAsset(assets, href)}</style>`;
  });

  // Escape `<` so no config value can close the script tag early. An operator name is attacker-
  // influenced in exactly the white-label case this SDK is built for.
  const cfg = JSON.stringify(bakedAppConfig(config)).replace(/</g, "\\u003c");
  const configTag = `<script>window.__AVOK_CONFIG__=${cfg}</script>`;
  const marker = out.indexOf(MODULE_OPEN);
  if (marker === -1) throw new Error("Vault build: the page has no module script to bake config before");
  out = out.slice(0, marker) + configTag + out.slice(marker);

  const inline = [
    ...[...out.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]),
    ...[...out.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]),
  ];
  const hashes = [...new Set(inline.map(sha256))];

  const csp = buildCsp(hashes);
  return { html: out, csp, headers: headersFileContent(csp) };
}

/**
 * The security invariant of the whole package, checked on the built result.
 *
 * The Vault origin can run the WebAuthn ceremony, and `K = HKDF(PRF(credential, rpId))`, so an XSS
 * or a stray external script there is a wallet drain rather than a defacement. These are the checks
 * that were `verify-inlined.mjs`, a build step whose mirror suite skipped whenever the build had not
 * run. Asserting them on a pure value removes the condition under which they do not run.
 */
export function assertVaultInvariants({ html, csp }: BuiltVault): void {
  const fail = (m: string) => {
    throw new Error(`VAULT INVARIANT VIOLATED: ${m}`);
  };

  if (/<script[^>]*\bsrc=/.test(html)) fail("the page has an external <script src=...>");
  if (/<link[^>]*\brel=["']stylesheet["']/.test(html)) fail("the page has an external stylesheet <link>");
  if (/\b(?:src|href)=["']https?:\/\//.test(html)) fail("the page references an external http(s) URL");

  // ANY leftover asset reference, not just the two tag shapes above. Vite emits
  // `<link rel="modulepreload" href="/assets/....js">` when it code-splits, which is neither a
  // script tag nor a stylesheet and is root-relative rather than absolute, so all three checks above
  // pass while the page is missing half its code. That is not hypothetical: it happened the first
  // time this build ran without `codeSplitting: false`.
  const dangling = [...html.matchAll(/\b(?:src|href)=["'](\/[^"']*\.(?:js|css|mjs))["']/g)].map((m) => m[1]);
  if (dangling.length > 0) {
    fail(
      `the page still references ${dangling.length} un-inlined asset(s): ${dangling.join(", ")}. ` +
        "Nothing will fetch them, because the CSP forbids it.",
    );
  }

  if (!/default-src 'none'/.test(csp)) fail("the CSP is missing default-src 'none'");
  if (!/script-src [^;]*'sha256-/.test(csp)) fail("the CSP's script-src is not sha256-pinned");
  if (/'unsafe-inline'/.test(csp)) fail("the CSP contains 'unsafe-inline'");
  if (!/connect-src 'none'/.test(csp))
    fail("the CSP is missing connect-src 'none'; the page must make no network call");
}

/** Every emitted file under `dir`, keyed by its path relative to `dir` with POSIX separators, which
 *  is how the HTML references them. */
async function collect(dir: string, base = dir): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of await collect(full, base)) out.set(k, v);
    } else if (/\.(js|css)$/.test(entry.name)) {
      out.set(relative(base, full).split(sep).join("/"), await readFile(full, "utf8"));
    }
  }
  return out;
}

/** Where `avok-vault build` writes, relative to the operator's project root.
 *
 *  NOT `dist`. This package's own `dist/` holds the compiled CLI, including the `avok-vault` binary
 *  named in `bin`, and it is in `files`. A build run from inside the package would delete the CLI and
 *  publish a wallet page in its place. A distinct name costs an operator nothing and removes the
 *  chance of that entirely. */
export const DEFAULT_OUT_DIR = "vault-dist";

/**
 * The IO around `inlinePage`: read the operator's config, bundle the page, inline it, assert the
 * invariants, and write the three files a static host needs.
 *
 * The invariants run on the way out. A build that would weaken the page fails here rather than
 * shipping, which is the guarantee `verify-inlined.mjs` used to provide as a separate script that
 * someone could forget to run.
 */
export async function buildVault(opts: { root: string; out: string }): Promise<BuiltVault> {
  const config = parseVaultConfig(JSON.parse(await readFile(join(opts.root, "avok-origin.config.json"), "utf8")));

  const staging = join(opts.root, ".vault-staging");
  await rm(staging, { recursive: true, force: true });
  await viteBuild({
    root: join(opts.root, "page"),
    logLevel: "warn",
    build: {
      outDir: staging,
      emptyOutDir: true,
      // ONE chunk, no code splitting. Split output leaves `<link rel="modulepreload">` tags pointing
      // at sibling chunks, and the inliner folds in only the entry script and the stylesheet. The
      // page then ships at half its size, missing its own code, and `default-src 'none'` blocks the
      // fetches that would have repaired it: a blank Vault. The build this replaced set the same
      // flag for the same reason.
      rollupOptions: { output: { codeSplitting: false } },
    },
  });

  const result = inlinePage({
    html: await readFile(join(staging, "index.html"), "utf8"),
    assets: await collect(staging),
    config,
  });
  assertVaultInvariants(result);

  await rm(opts.out, { recursive: true, force: true });
  await mkdir(opts.out, { recursive: true });
  await writeFile(join(opts.out, "index.html"), result.html);
  await writeFile(join(opts.out, "_headers"), result.headers);
  await writeFile(join(opts.out, "csp-headers.txt"), `${result.csp}\n`);
  await rm(staging, { recursive: true, force: true });
  return result;
}
