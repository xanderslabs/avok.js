/**
 * Guardian connect-and-sign (TDD §7 branch a) — the Vault page's OWN EIP-6963 discovery of an
 * injected wallet, so a guardian with a real, connected wallet (MetaMask etc.) can sign the recovery
 * approval through its own `eth_signTypedData_v4`, standard EIP-712, no blind-signing, no key ever
 * touching the Vault.
 *
 * This is the mirror image of `provider/eip6963.ts` (which ANNOUNCES an Avok-backed provider outward,
 * for a dapp to find). Here the Vault page is the DISCOVERER, not the announcer — nothing in this
 * codebase does that yet, so this is new, minimal wiring: request, collect what answers, connect one.
 */
import { getAddress, type Address, type Hex } from "viem";
import type { Eip1193Provider } from "../../provider/eip1193.js";
import type { Eip6963ProviderInfo } from "../../provider/eip6963.js";
import type { RecoveryApprovalTypedData } from "../../vault/recover/approve.js";

export interface DiscoveredProvider {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

/** The subset of `window` EIP-6963 discovery needs — injectable so this is testable without a DOM. */
export interface Eip6963Window {
  addEventListener(type: "eip6963:announceProvider", fn: (e: { detail: unknown }) => void): void;
  addEventListener(type: "eip6963:requestProvider", fn: (e: { detail: unknown }) => void): void;
  removeEventListener(type: string, fn: (e: { detail: unknown }) => void): void;
  dispatchEvent(event: { type: string }): boolean;
}

const DEFAULT_TIMEOUT_MS = 150;

/**
 * Dispatch `eip6963:requestProvider` and collect every `eip6963:announceProvider` response for
 * `timeoutMs`. A short, fixed window rather than "wait for the first one": EIP-6963 responders answer
 * synchronously off the same event loop turn, so there is nothing further to wait for in practice, and
 * a fixed window avoids hanging forever on a page with no injected wallet at all.
 */
export function discoverInjectedProviders(
  win: Eip6963Window,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DiscoveredProvider[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredProvider>();
    const onAnnounce = (e: { detail: unknown }): void => {
      const { info, provider } = e.detail as DiscoveredProvider;
      found.set(info.uuid, { info, provider });
    };
    win.addEventListener("eip6963:announceProvider", onAnnounce);
    win.dispatchEvent({ type: "eip6963:requestProvider" });
    setTimeout(() => {
      win.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

/**
 * Connect the first injected wallet that answers discovery and return a `signTypedData` closure over
 * it. No multi-wallet picker: this screen needs exactly one guardian signature from one wallet the
 * browser already has, not a general wallet-connection UI. If an operator's Vault needs to pick among
 * several, that is a follow-up, not a v1 requirement.
 */
export async function connectGuardianWallet(
  win: Eip6963Window,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ address: Address; signTypedData: (typedData: RecoveryApprovalTypedData) => Promise<Hex> }> {
  const found = await discoverInjectedProviders(win, timeoutMs);
  const first = found[0];
  if (!first) {
    throw new Error("No wallet extension found — install one to approve as a connected guardian.");
  }
  const { provider } = first;
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts[0];
  if (!account) throw new Error("The connected wallet returned no account.");
  const address = getAddress(account);
  return {
    address,
    async signTypedData(typedData: RecoveryApprovalTypedData): Promise<Hex> {
      return (await provider.request({
        method: "eth_signTypedData_v4",
        params: [address, JSON.stringify(typedData)],
      })) as Hex;
    },
  };
}
