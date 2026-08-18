import { securityHeaders } from "./headers.js";

/**
 * Confirm a DEPLOYED Vault is actually being served with its headers.
 *
 * This is a deploy sanity check, not a security control. It cannot detect a compromised host, because
 * an attacker who controls hosting serves the good file to whatever is checking and the bad file to
 * users. What it does catch is the most likely silent failure in the whole design: a static host that
 * ignores `_headers`, leaving a page that works perfectly with all of its hardening absent.
 *
 * That failure is not hypothetical. The build this package replaced emitted its `_headers` rule for
 * the path `/index` while serving `index.html` at `/`, so the rule matched no request and the policy
 * was never applied. Nothing revealed it, because the page worked. This command is what reveals it.
 */
export function evaluateDeployedHeaders(
  headers: Headers,
  opts?: { route: "signing" | "recovery" },
): { ok: boolean; problems: string[] } {
  const route = opts?.route ?? "signing";
  const problems: string[] = [];

  const csp = headers.get("content-security-policy");
  if (!csp) {
    problems.push(
      "Content-Security-Policy is missing. The page will work and none of its hardening will apply. " +
        "Configure your host to send the values in vault-dist/csp-headers.txt.",
    );
  } else {
    if (csp.includes("unsafe-inline")) problems.push("Content-Security-Policy admits 'unsafe-inline'");
    if (!csp.includes("frame-ancestors")) problems.push("Content-Security-Policy has no frame-ancestors");
    if (!csp.includes("default-src 'none'")) problems.push("Content-Security-Policy has no default-src 'none'");
    // connect-src is now the operator's pinned RPC set (TDD §8), not 'none' — a deployed policy that
    // still says 'none' is STALE (built before this change) just as surely as a missing directive.
    const connectSrcMatch = csp.match(/connect-src ([^;]+)/);
    if (!connectSrcMatch) {
      problems.push("Content-Security-Policy has no connect-src; the deployed policy may be stale");
    } else {
      const sources = connectSrcMatch[1].trim().split(/\s+/);
      if (sources.length === 0 || sources[0] === "'none'") {
        problems.push(
          "Content-Security-Policy's connect-src is 'none'; the deployed policy is stale (the Vault " +
            "now needs RPC access for simulation and recovery — see avok-origin.config.json's chains)",
        );
      } else if (sources.some((s) => s === "*" || s === "'unsafe-inline'")) {
        problems.push("Content-Security-Policy's connect-src is wider than a pinned RPC set");
      }
    }
    if (!csp.includes("require-trusted-types-for")) {
      problems.push("Content-Security-Policy does not enforce trusted-types; the deployed policy may be stale");
    }
  }

  // ONE PAGE, TWO ROUTES, TWO HEADER SETS (D7 gate decision, 2026-08-18). The signing route's COOP
  // invariant is unchanged: COOP severs window.opener, and the popup's only way to return a signature
  // is through that relationship, so signing would fail after the user has already approved. The
  // recovery route is the opposite requirement: identity recovery's threaded-WASM proving needs a
  // cross-origin-isolated context, so COOP+COEP must be PRESENT there, not absent.
  if (route === "signing" && headers.has("cross-origin-opener-policy")) {
    problems.push(
      "Cross-Origin-Opener-Policy is set. It severs window.opener, and the popup's only way to return " +
        "a signature is through that relationship, so signing will fail after the user has already " +
        "approved. Remove it.",
    );
  }
  if (route === "recovery") {
    const coop = headers.get("cross-origin-opener-policy");
    if (!coop) {
      problems.push(
        "Cross-Origin-Opener-Policy is missing on the recovery route. Identity recovery's threaded-WASM " +
          "proving needs a cross-origin-isolated context; set it to same-origin.",
      );
    } else if (coop !== "same-origin") {
      problems.push(`Cross-Origin-Opener-Policy on the recovery route is "${coop}", not "same-origin".`);
    }
    if (!headers.has("cross-origin-embedder-policy")) {
      problems.push(
        "Cross-Origin-Embedder-Policy is missing on the recovery route. Identity recovery's threaded-WASM " +
          "proving needs a cross-origin-isolated context; set it to require-corp.",
      );
    }
  }

  for (const name of Object.keys(securityHeaders())) {
    if (!headers.has(name.toLowerCase())) problems.push(`${name} is missing`);
  }

  return { ok: problems.length === 0, problems };
}

/** The recovery route's URL for a deployed Vault — ORIGIN-RELATIVE, never appended to whatever path
 *  the caller passed. `avok-vault check <url>` is documented and already deployed as "pass the
 *  Vault's origin," so this derives the second URL from that same origin rather than requiring a
 *  second CLI argument nobody has typed before. */
export function deriveRecoveryUrl(url: string): string {
  return new URL("/recover", url).toString();
}

async function checkOneRoute(url: string, route: "signing" | "recovery", log: (s: string) => void): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (e) {
    // An unreachable host is an ordinary outcome for this command (wrong URL, not deployed yet, DNS
    // still propagating). Report it as one rather than stack-tracing at the operator.
    log(`avok-vault: could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }

  if (!response.ok) {
    log(`avok-vault: ${url} answered ${response.status} ${response.statusText}. Checking headers anyway.`);
  }

  const result = evaluateDeployedHeaders(response.headers, { route });
  if (result.ok) {
    log(`avok-vault: ${url} is serving every required header.`);
    return true;
  }
  log(`avok-vault: ${url} has ${result.problems.length} problem(s):`);
  for (const p of result.problems) log(`  - ${p}`);
  return false;
}

/**
 * Checks BOTH routes of a deployed Vault: the signing route at `url` itself, and the recovery route
 * derived from it (see `deriveRecoveryUrl`). One page, two header sets — a deploy that only wires one
 * of them is exactly the silent-failure shape this whole command exists to catch, so passing on one
 * route while failing the other is still a failing check.
 */
export async function runCheck(url: string, log: (s: string) => void): Promise<number> {
  const signingOk = await checkOneRoute(url, "signing", log);
  const recoveryOk = await checkOneRoute(deriveRecoveryUrl(url), "recovery", log);
  return signingOk && recoveryOk ? 0 : 1;
}
