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
export function evaluateDeployedHeaders(headers: Headers): { ok: boolean; problems: string[] } {
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

  if (headers.has("cross-origin-opener-policy")) {
    problems.push(
      "Cross-Origin-Opener-Policy is set. It severs window.opener, and the popup's only way to return " +
        "a signature is through that relationship, so signing will fail after the user has already " +
        "approved. Remove it.",
    );
  }

  for (const name of Object.keys(securityHeaders())) {
    if (!headers.has(name.toLowerCase())) problems.push(`${name} is missing`);
  }

  return { ok: problems.length === 0, problems };
}

export async function runCheck(url: string, log: (s: string) => void): Promise<number> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (e) {
    // An unreachable host is an ordinary outcome for this command (wrong URL, not deployed yet, DNS
    // still propagating). Report it as one rather than stack-tracing at the operator.
    log(`avok-vault: could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  if (!response.ok) {
    log(`avok-vault: ${url} answered ${response.status} ${response.statusText}. Checking headers anyway.`);
  }

  const result = evaluateDeployedHeaders(response.headers);
  if (result.ok) {
    log(`avok-vault: ${url} is serving every required header.`);
    return 0;
  }
  log(`avok-vault: ${url} has ${result.problems.length} problem(s):`);
  for (const p of result.problems) log(`  - ${p}`);
  return 1;
}
