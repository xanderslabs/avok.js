import { access, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parseVaultConfig, VaultConfigError, type VaultConfig } from "./config.js";

export interface InitAnswers {
  vaultOrigin: string;
  /** Optional. Defaults to the Vault origin's host, which is the tightest scope WebAuthn allows. */
  rpId?: string;
  operatorName?: string;
}

/**
 * Turn the answers into a validated config.
 *
 * The rpId default is the Vault's own host rather than the apex. Only the Vault ever calls WebAuthn,
 * so nothing needs the credential to be assertable from sibling subdomains, and an operator who later
 * loses control of another subdomain does not thereby lose the passkey. An operator migrating
 * existing passkeys passes their historical rpId explicitly.
 */
export function buildInitConfig(answers: InitAnswers): VaultConfig {
  let host: string;
  try {
    host = new URL(answers.vaultOrigin).hostname;
  } catch {
    // `new URL` throws a bare "Invalid URL" TypeError. This is the first command an operator runs
    // and the origin is the first thing they type, so say what a valid answer looks like.
    throw new VaultConfigError(
      `"${answers.vaultOrigin}" is not a URL. Give the Vault's full origin, including the scheme, ` +
        "for example https://vault.example.com.",
    );
  }

  const draft: Record<string, unknown> = {
    rpId: answers.rpId ?? host,
    vaultOrigin: answers.vaultOrigin,
  };
  if (answers.operatorName) draft.branding = { operatorName: answers.operatorName };
  return parseVaultConfig(draft);
}

/**
 * Write `avok-origin.config.json`, interactively.
 *
 * It REFUSES to overwrite. The file holds the pinned rpId, and rewriting that value silently is the
 * one edit that costs a user their wallet: `K = HKDF(PRF(credential, rpId))`, so a different rpId is
 * a different key and their funds are at an address the new config cannot reach.
 */
export async function runInit(cwd: string, log: (s: string) => void): Promise<number> {
  const target = `${cwd}/avok-origin.config.json`;
  try {
    await access(target);
    log("avok-vault: avok-origin.config.json already exists. Edit it, or delete it and run init again.");
    return 1;
  } catch {
    // Absent, which is what we want.
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const vaultOrigin = (await rl.question("Vault origin (e.g. https://vault.example1.com): ")).trim();
    let defaultRpId: string;
    try {
      defaultRpId = new URL(vaultOrigin).hostname;
    } catch {
      log(`avok-vault: "${vaultOrigin}" is not a URL. Give the full origin, e.g. https://vault.example.com`);
      return 1;
    }
    const rpIdAnswer = await rl.question(`RP-ID [${defaultRpId}]: (enter to accept, or pin a historical value) `);
    const operatorName = await rl.question("Operator name (shown to users): ");

    const config = buildInitConfig({
      vaultOrigin,
      ...(rpIdAnswer.trim() ? { rpId: rpIdAnswer.trim() } : {}),
      ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
    });
    await writeFile(target, `${JSON.stringify(config, null, 2)}\n`);
    log("avok-vault: wrote avok-origin.config.json. Next: avok-vault build");
    return 0;
  } catch (e) {
    // A validation failure here is the operator's typo, not a crash. Print it and exit non-zero.
    if (e instanceof VaultConfigError) {
      log(`avok-vault: ${e.message}`);
      return 1;
    }
    throw e;
  } finally {
    rl.close();
  }
}
