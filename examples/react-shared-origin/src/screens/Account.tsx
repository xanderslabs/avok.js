import { useState } from "react";
import { useAccount, useAvok, useLogout } from "@avokjs/react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { config } from "../config.js";
import { classifySendError, type SendErrorKind } from "@avokjs/core/helpers";
import { resolver } from "../resolver.js";
import { Screen, Card, Field, Button, AddressText, ErrorNote } from "../ui/index.js";

// Shared-origin is a dapp, so it signs through the STANDARD surfaces — never an Avok-specific verb:
//   EVM    → the EIP-1193 provider (`personal_sign`); the wallet's popup shows the message and signs.
//   Solana → the Wallet Standard (`solana:signMessage`), discovered off the page's wallet registry
//            exactly as `@solana/wallet-adapter` would find it, with zero Avok imports in the path.
// #3 removed the per-verb `useSign`/`useSolanaSign` hooks; these replace them.
type Eip1193Like = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

type SignMessageFeature = {
  signMessage(input: { account: WalletAccount; message: Uint8Array }): Promise<{ signature: Uint8Array }[]>;
};

/** Find the Avok wallet the way any Solana dapp does: ask the page, match on the standard feature. */
function findSolanaWallet(): Wallet | undefined {
  return getWallets()
    .get()
    .find((w) => w.name === "Avok" && "solana:signMessage" in w.features);
}

/** base58 — the encoding every Solana explorer and RPC speaks. */
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function toBase58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

// Operator name is derived from the auth origin's host — this app never
// renders a hardcoded brand for the operator.
function operatorName(authOrigin: string): string {
  try {
    return new URL(authOrigin).hostname;
  } catch {
    return authOrigin;
  }
}

export function Account({ onBack, onLoggedOut }: { onBack?: () => void; onLoggedOut: () => void }) {
  const { account } = useAccount();
  const client = useAvok();
  const { logout } = useLogout();
  const [evmSigning, setEvmSigning] = useState(false);
  const [solSigning, setSolSigning] = useState(false);

  const [message, setMessage] = useState("Hello from Avok demo");
  const [evmSig, setEvmSig] = useState<string | null>(null);
  const [solSig, setSolSig] = useState<string | null>(null);
  const [signErr, setSignErr] = useState<{ kind: SendErrorKind; message: string } | null>(null);

  const [lookup, setLookup] = useState("");
  const [resolved, setResolved] = useState<{ evm?: string; solana?: string } | null | undefined>(undefined);
  const [resolving, setResolving] = useState(false);
  const [resolveErr, setResolveErr] = useState<{ kind: SendErrorKind; message: string } | null>(null);

  const [loggingOut, setLoggingOut] = useState(false);

  if (!account) return null;

  const operator = operatorName(config.authOrigin);

  async function handleSignEvm() {
    setSignErr(null);
    setEvmSig(null);
    setEvmSigning(true);
    try {
      // Standard provider signing: the wallet's popup shows the message and signs it (personal_sign).
      const provider = (client as unknown as { getEip1193Provider(): Eip1193Like }).getEip1193Provider();
      const sig = (await provider.request({ method: "personal_sign", params: [message, account!.evm.address] })) as string;
      setEvmSig(sig);
    } catch (e) {
      setSignErr(classifySendError(e));
    } finally {
      setEvmSigning(false);
    }
  }

  async function handleSignSolana() {
    setSignErr(null);
    setSolSig(null);
    setSolSigning(true);
    try {
      const wallet = findSolanaWallet();
      if (!wallet) throw new Error("No Solana Wallet Standard wallet found on this page");
      const walletAccount = wallet.accounts.find((a) => a.address === account!.solana.address) ?? wallet.accounts[0];
      if (!walletAccount) throw new Error("The Solana wallet has no connected account");

      // The standard passes BYTES, not a string — the wallet's popup shows the message and signs it.
      const feature = wallet.features["solana:signMessage"] as SignMessageFeature;
      const [result] = await feature.signMessage({
        account: walletAccount,
        message: new TextEncoder().encode(message),
      });
      setSolSig(toBase58(result!.signature));
    } catch (e) {
      setSignErr(classifySendError(e));
    } finally {
      setSolSigning(false);
    }
  }

  async function handleResolve() {
    setResolveErr(null);
    setResolved(undefined);
    setResolving(true);
    try {
      // Any ENS/SNS name → address(es) via the SDK facade (.sol→SNS, else→ENS).
      setResolved(await resolver.resolveForward(lookup.trim()));
    } catch (e) {
      setResolveErr(classifySendError(e));
    } finally {
      setResolving(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      onLoggedOut();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <Screen title="Account" onBack={onBack}>
      <p style={{ fontSize: 12, marginBottom: 14 }}>
        Managed by <b>{operator}</b> — export, access slots, and device management happen at the operator's app, not here.
      </p>

      {/* Addresses */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
          Identity
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 11, width: 46 }}>EVM</span>
          <AddressText address={account.evm.address} copy />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 11, width: 46 }}>Solana</span>
          <AddressText address={account.solana.address} copy />
        </div>
      </Card>

      {/* Management — done at the operator's app */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
          Wallet management
        </div>
        {config.managementUrl ? (
          <>
            <p style={{ fontSize: 12, marginBottom: 10 }}>
              Add devices or export at {operator}.
            </p>
            <Button variant="ghost" onClick={() => window.open(config.managementUrl, "_blank", "noopener")}>
              Manage at {operator}
            </Button>
          </>
        ) : (
          <p style={{ fontSize: 12 }}>Wallet management isn't currently configured for this app.</p>
        )}
      </Card>

      {/* Sign a message */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
          Sign a message
        </div>
        <Field label="Message" value={message} onChange={setMessage} placeholder="Message to sign" />
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <Button variant="ghost" onClick={handleSignEvm} disabled={evmSigning || !message.trim()}>
            {evmSigning ? "Signing…" : "Sign (EVM)"}
          </Button>
          <Button variant="ghost" onClick={handleSignSolana} disabled={solSigning || !message.trim()}>
            {solSigning ? "Signing…" : "Sign (Solana)"}
          </Button>
        </div>
        {signErr && <ErrorNote kind={signErr.kind} message={signErr.message} />}
        {evmSig && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, marginBottom: 4 }}>EVM signature</div>
            <AddressText address={evmSig} copy />
          </div>
        )}
        {solSig && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, marginBottom: 4 }}>Solana signature</div>
            <AddressText address={solSig} copy />
          </div>
        )}
      </Card>

      {/* Subname resolve (use-only: no register/mint) */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
          Look up a name
        </div>
        <Field label="Name" value={lookup} onChange={setLookup} placeholder="e.g. ada.avok.eth or alice.sol" />
        <Button variant="ghost" onClick={handleResolve} disabled={resolving || !lookup.trim()}>
          {resolving ? "Resolving…" : "Resolve"}
        </Button>
        {resolved !== undefined && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {resolved?.evm && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, width: 46 }}>EVM</span>
                <AddressText address={resolved.evm} truncate={false} copy />
              </div>
            )}
            {resolved?.solana && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, width: 46 }}>Solana</span>
                <AddressText address={resolved.solana} truncate={false} copy />
              </div>
            )}
            {(!resolved || (!resolved.evm && !resolved.solana)) && (
              <p style={{ fontSize: 12, margin: 0 }}>No address found.</p>
            )}
          </div>
        )}
        {resolveErr && (
          <div style={{ marginTop: 8 }}>
            <ErrorNote kind={resolveErr.kind} message={resolveErr.message} />
          </div>
        )}
      </Card>

      {/* Disconnect */}
      <Card>
        <Button variant="ghost" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? "Disconnecting…" : "Disconnect"}
        </Button>
      </Card>
    </Screen>
  );
}
