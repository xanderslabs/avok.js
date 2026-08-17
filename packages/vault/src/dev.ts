import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { securityHeaders } from "./headers.js";

/**
 * Serve the built Vault locally WITH the real headers, so development exercises the same policy
 * production does.
 *
 * A dev server that omits the CSP hides every violation until deploy, and the violations this policy
 * produces are not subtle: `default-src 'none'` and enforced Trusted Types turn a stray fetch or a
 * stray DOM sink into a dead page. Finding that here costs a reload. Finding it after deploy costs a
 * release.
 *
 * The CSP comes from the emitted file rather than being recomputed, so what is served is exactly what
 * a host would send. If the build has not run, say so instead of serving an unprotected page.
 */
export async function startDevServer(out: string, port: number): Promise<{ server: Server; url: string }> {
  // Fail fast if nothing is built, but do NOT keep what we read: see below.
  try {
    await readFile(join(out, "index.html"), "utf8");
  } catch {
    throw new Error(`avok-vault dev: nothing built at ${out}. Run \`avok-vault build\` first.`);
  }

  // READ PER REQUEST, not once at boot. Caching the page means a rebuild in another terminal changes
  // nothing on refresh, silently: the browser shows the old bytes with no indication they are stale,
  // and you debug a page that no longer exists. Costing two file reads per request in a local dev
  // server to remove that is not a trade worth thinking about.
  const server = createServer((_req, res) => {
    void (async () => {
      try {
        const html = await readFile(join(out, "index.html"), "utf8");
        const csp = (await readFile(join(out, "csp-headers.txt"), "utf8")).trim();
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": csp,
          ...securityHeaders(),
        });
        res.end(html);
      } catch {
        // A build running right now can leave the directory momentarily empty. Say so plainly
        // rather than serving a blank 200, which would look like a broken page.
        res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("avok-vault dev: the build output is missing or mid-write. Re-run `avok-vault build`.");
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  return { server, url: `http://localhost:${port}` };
}

export async function runDev(out: string, port: number, log: (s: string) => void): Promise<number> {
  let started: { server: Server; url: string };
  try {
    started = await startDevServer(out, port);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return 1;
  }
  log(`avok-vault: serving ${out} on ${started.url} with the production headers`);
  return new Promise<number>(() => {
    // Runs until interrupted.
  });
}
