import { resolveChainByName, getChainProfileById } from "@avokjs/contracts";

/**
 * The operator's Vault configuration, validated at BUILD time.
 *
 * There is no server to validate at request time, and the values that matter cannot fail safely at
 * runtime. An unset or wrong `rpId` does not error: it derives a DIFFERENT wallet, and the user sees
 * an empty account where their funds were. A Vault served over plaintext is not a Vault. An unknown
 * chain name means a pinned CSP that admits an RPC nobody validated. All three are caught here,
 * before anything is deployed.
 */
export interface VaultConfig {
  /** The pinned WebAuthn RP-ID. `K = HKDF(PRF(credential, rpId))`, so this value IS the wallet. */
  rpId: string;
  /** The origin the Vault is deployed at, e.g. `https://vault.example1.com`. */
  vaultOrigin: string;
  /** Registry chain names (e.g. "base", "ethereum") this Vault serves — TDD §8. Determines which RPC
   *  endpoints `connect-src` is pinned to; the Vault can reach exactly these and nothing else. */
  chains: string[];
  /** Per-chain RPC override, keyed by the same names as `chains`. Unset chains fall back to the
   *  registry's default (`EvmChainProfile.rpcDefault`) — see TDD §8 for what those currently are. */
  rpcOverrides?: Record<string, string>;
  branding?: { operatorName?: string };
  /** Optional first-party management app URL, surfaced to apps that borrow the wallet. */
  managementUrl?: string;
}

/** Chain name -> the RPC URL actually pinned into `connect-src` (override, or the registry default). */
export type ResolvedVaultRpcs = Record<string, string>;

export function resolveVaultRpcs(config: VaultConfig): ResolvedVaultRpcs {
  const out: ResolvedVaultRpcs = {};
  for (const name of config.chains) {
    const override = config.rpcOverrides?.[name];
    if (override) {
      out[name] = override;
      continue;
    }
    const id = resolveChainByName(name); // throws with the valid-names list on a typo
    const profile = getChainProfileById(id);
    // Cannot happen if resolveChainByName succeeded (every name it accepts is a registry key), but
    // narrows the type without an assertion.
    if (!profile || profile.kind !== "evm") {
      throw new VaultConfigError(`avok-origin.config.json: chain "${name}" has no RPC default in the registry`);
    }
    out[name] = profile.rpcDefault;
  }
  return out;
}

export class VaultConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultConfigError";
  }
}

const PLACEHOLDER_RP_ID = "wallet.example.com";

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * WebAuthn's rule: an rpId must equal the caller's effective domain or be a registrable domain
 * suffix of it. The Vault page IS the caller, so the check is against the Vault origin's host.
 * Enforcing it here turns a silent "no passkey found, and a different wallet if one is created"
 * into a build failure.
 *
 * The leading dot is load-bearing. A plain `endsWith(rpId)` would accept `notexample.com` for an
 * rpId of `example.com`, which is a different registrable domain and a lookalike's way in.
 */
function isRegistrableSuffix(rpId: string, host: string): boolean {
  if (rpId === host) return true;
  return host.endsWith(`.${rpId}`);
}

export function parseVaultConfig(raw: unknown): VaultConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new VaultConfigError("avok-origin.config.json must contain a JSON object");
  }
  const o = raw as Record<string, unknown>;

  // Reject rather than ignore. A key the build silently drops is one the operator believes is in
  // effect, and this one used to be: it reached `AuthPopupConfig.defaultChainId`, which nothing
  // reads. Enrolment's anchor chain is a different value on `ClientConfig` and is unaffected.
  if ("anchorChainId" in o) {
    throw new VaultConfigError(
      "avok-origin.config.json: anchorChainId is not a Vault config value. The Vault popup only " +
        "authorizes and signs; it never enrols a device, so it has no use for an anchor chain. If " +
        "you are setting the chain a secondary device's access slot is written to, that is " +
        "`anchorChainId` on the client config in your app, not here. Remove this key.",
    );
  }

  const rpId = o.rpId;
  if (typeof rpId !== "string" || rpId.trim() === "") {
    throw new VaultConfigError(
      "avok-origin.config.json: rpId is required. It scopes the passkey PRF that IS the wallet key, " +
        "so pin it explicitly and never infer it from a URL or hostname.",
    );
  }
  if (rpId === PLACEHOLDER_RP_ID) {
    throw new VaultConfigError(
      `avok-origin.config.json: rpId is still the placeholder "${PLACEHOLDER_RP_ID}", which is not a ` +
        "config. Set it to YOUR pinned RP-ID.",
    );
  }

  const vaultOrigin = o.vaultOrigin;
  if (typeof vaultOrigin !== "string" || vaultOrigin.trim() === "") {
    throw new VaultConfigError("avok-origin.config.json: vaultOrigin is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(vaultOrigin);
  } catch {
    throw new VaultConfigError(`avok-origin.config.json: vaultOrigin is not a URL: ${vaultOrigin}`);
  }

  if (parsed.protocol !== "https:" && !isLocalhost(parsed.hostname)) {
    throw new VaultConfigError(
      `avok-origin.config.json: vaultOrigin must use https (got "${vaultOrigin}"). ` +
        "http is allowed only for localhost during development.",
    );
  }

  if (!isRegistrableSuffix(rpId, parsed.hostname)) {
    throw new VaultConfigError(
      `avok-origin.config.json: rpId "${rpId}" is not valid for a Vault at "${parsed.hostname}". ` +
        "WebAuthn requires the rpId to equal the calling origin's host or be a registrable domain " +
        "suffix of it. Pin the Vault's own host unless you are migrating passkeys created under a " +
        "broader rpId, in which case pin that historical value or your users land in a new wallet.",
    );
  }

  const chainsRaw = o.chains;
  if (!Array.isArray(chainsRaw) || chainsRaw.length === 0 || !chainsRaw.every((c) => typeof c === "string")) {
    throw new VaultConfigError(
      "avok-origin.config.json: chains is required and must be a non-empty array of registry chain " +
        'names (e.g. ["base", "ethereum"]). These become the CSP connect-src the Vault is allowed ' +
        "to reach — an empty list would leave simulation and recovery unable to read any chain.",
    );
  }
  const chains = chainsRaw as string[];
  // Fail loud on a typo NOW — resolveVaultRpcs is also called at build time, but the operator should
  // not have to run the bundler to discover a bad chain name.
  for (const name of chains) {
    try {
      resolveChainByName(name);
    } catch (e) {
      throw new VaultConfigError(`avok-origin.config.json: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const config: VaultConfig = { rpId, vaultOrigin, chains };
  const rpcOverridesRaw = o.rpcOverrides;
  if (typeof rpcOverridesRaw === "object" && rpcOverridesRaw !== null) {
    const overrides: Record<string, string> = {};
    for (const [k, v] of Object.entries(rpcOverridesRaw as Record<string, unknown>)) {
      if (typeof v === "string") overrides[k] = v;
    }
    if (Object.keys(overrides).length > 0) config.rpcOverrides = overrides;
  }
  const branding = o.branding;
  if (typeof branding === "object" && branding !== null) {
    const operatorName = (branding as Record<string, unknown>).operatorName;
    if (typeof operatorName === "string") config.branding = { operatorName };
  }
  if (typeof o.managementUrl === "string") config.managementUrl = o.managementUrl;
  return config;
}

/** The object baked into the page as `window.__AVOK_CONFIG__`. White-label: the default operator
 *  name is the operator's own rpId, never a hardcoded "Avok". `rpcUrls` is what lets the page's own
 *  runtime (vault/simulate, vault/recover) construct an RpcClient — the exact same URLs `connect-src`
 *  pins, so the page can never reach anywhere its own CSP would not already admit. */
export interface BakedAppConfig {
  operatorName: string;
  vaultOrigin: string;
  rpId: string;
  managementUrl?: string;
  rpcUrls: ResolvedVaultRpcs;
}

export function bakedAppConfig(config: VaultConfig): BakedAppConfig {
  const out: BakedAppConfig = {
    operatorName: config.branding?.operatorName ?? config.rpId,
    vaultOrigin: config.vaultOrigin,
    rpId: config.rpId,
    rpcUrls: resolveVaultRpcs(config),
  };
  if (config.managementUrl) out.managementUrl = config.managementUrl;
  return out;
}
