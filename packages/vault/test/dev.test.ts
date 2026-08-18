import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { startDevServer } from "../src/dev.js";

let server: Server | undefined;
let dir: string | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (dir) await rm(dir, { recursive: true, force: true });
  server = undefined;
  dir = undefined;
});

// dev.ts serves the built page LOCALLY WITH THE REAL HEADERS — it has to branch by request path the
// same way `_headers` does, or local dev silently diverges from what `build`/`check` actually
// enforce: the recovery route would look fine in dev and then fail `avok-vault check` after deploy.
describe("startDevServer — per-path headers", () => {
  it("serves the base header set (no COOP) at the root path", async () => {
    dir = await mkdtemp(join(tmpdir(), "avok-vault-dev-"));
    await writeFile(join(dir, "index.html"), "<html></html>");
    await writeFile(join(dir, "csp-headers.txt"), "default-src 'none'\n");
    const started = await startDevServer(dir, 0);
    server = started.server;
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.headers.get("cross-origin-opener-policy")).toBeNull();
    expect(res.headers.get("cross-origin-embedder-policy")).toBeNull();
  });

  it("serves COOP+COEP on the /recover route", async () => {
    dir = await mkdtemp(join(tmpdir(), "avok-vault-dev-"));
    await writeFile(join(dir, "index.html"), "<html></html>");
    await writeFile(join(dir, "csp-headers.txt"), "default-src 'none'\n");
    const started = await startDevServer(dir, 0);
    server = started.server;
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const res = await fetch(`http://localhost:${port}/recover`);
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
    // Still the same page — recovery is a client-side branch on the same bundle, not a second file.
    expect(await res.text()).toBe("<html></html>");
  });
});
