/**
 * mountRecoverPage — wires the real gestures (passkey, EIP-6963, the anchor chain's RPC) to the pure
 * `RecoverCeremony` (ceremony.ts) and the plain-DOM view (view-dom.ts). This is `mount.ts`'s sibling
 * for the recovery screen: same split (pure driver, real edges only here), same reason (unit-test the
 * driver without a browser; exercise the gestures by hand, same as every other WebAuthn/EIP-6963 path
 * in this codebase).
 */
import { createPublicClient, type Address } from "viem";
import { createViemRpcClient, createFailoverTransport, type ViemLike } from "../../evm/rpc.js";
import { createEnsResolver } from "../../helpers/ens-resolver.js";
import type { EnsClient } from "../../helpers/ens-reader.js";
import { createNameResolver } from "../../helpers/resolver.js";
import { WebAuthnPasskeyAdapter } from "../../wallet/index.js";
import { createWallet } from "../../wallet/wallet.js";
import { startRecoveryFlow } from "../../vault/recover/flow.js";
import type { AuthPopupConfig } from "../ceremony.js";
import { createRecoverCeremony, type RecoverCeremonyDeps } from "./ceremony.js";
import { connectGuardianWallet, type Eip6963Window } from "./discover-guardian-provider.js";
import { mountRecoverView } from "./view-dom.js";

/** Build the real `RecoverCeremonyDeps` from the Vault's baked config. Fails LOUD — never guesses a
 *  chain or silently falls back — because guessing here means reading (and later approving against)
 *  the wrong wallet's guardian state on the wrong chain. */
export function recoverCeremonyDeps(config: AuthPopupConfig): RecoverCeremonyDeps {
  const chainId = config.recoveryChainId;
  if (chainId === undefined) {
    throw new Error(
      "recoverCeremonyDeps: config carries no recoveryChainId — the recovery screen has no anchor chain to read guardian state from",
    );
  }
  const urls = config.rpcUrlsByChainId?.[chainId];
  if (!urls || urls.length === 0) {
    throw new Error(`No RPC configured for chain ${chainId} — cannot read guardian state for recovery`);
  }
  const client = createPublicClient({ transport: createFailoverTransport(urls) });
  const rpc = createViemRpcClient(client as unknown as ViemLike);

  // ENS resolution against the SAME anchor-chain client. ENS itself lives on Ethereum mainnet; on any
  // other anchor chain this simply resolves nothing (an unrecognised registry, not a crash) — a
  // convenience miss, not a correctness one, since "enter address or ENS" already accepts a raw
  // address as the always-available path. See mount.ts's report for why this wasn't given its own,
  // separately-configured RPC: TDD §7 does not ask for one, and the Vault's CSP only ever pins the
  // chains the operator actually configured.
  const ensService = createEnsResolver({ chainId, client: client as unknown as EnsClient });
  const nameResolver = createNameResolver({ ens: ensService });

  const passkey = new WebAuthnPasskeyAdapter({ rpName: config.operatorName, rpId: config.rpId });

  return {
    flow: startRecoveryFlow({
      rpc,
      resolveName: (name) => nameResolver.resolveForward(name).then((r) => r?.evm ?? null),
    }),
    chainId,
    async mintPromoteKey(): Promise<{ address: Address }> {
      const { account } = await createWallet({ passkey, networkName: config.operatorName });
      return { address: account.evm };
    },
    connectGuardianWallet: () => connectGuardianWallet(window as unknown as Eip6963Window),
  };
}

/** Mount the "Recover a wallet" screen into `root` (defaults to `#root`). */
export function mountRecoverPage(config: AuthPopupConfig, root?: HTMLElement): void {
  const el = root ?? document.getElementById("root");
  if (!el) throw new Error('mountRecoverPage: no root element (pass one, or add <div id="root"> to the page)');
  const ceremony = createRecoverCeremony(recoverCeremonyDeps(config));
  mountRecoverView(el, ceremony);
}
