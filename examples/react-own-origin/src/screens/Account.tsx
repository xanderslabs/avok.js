import { useEffect, useState } from "react";
import { useAccount, useSelfCustody } from "@avokjs/react";

// Own-origin IS the wallet: it signs messages in-page via the SDK's `evm`/`solana` namespaces (same as
// the vanilla-own demo). #3 removed the `useSign`/`useSolanaSign` hooks; reach the namespaces directly.
type SignNS = { evm: { signMessage(a: { message: string }): Promise<string> }; solana: { signMessage(m: string): Promise<{ signature: string }> } };
import { config } from "../config.js";
import { classifySendError, type SendErrorKind } from "@avokjs/helpers";
import { Screen, Card, Field, Button, AddressText, ListRow, ErrorNote, Stack, Text } from "../ui/index.js";

type ExportStep = "idle" | "confirm" | "done";

export function Account({
  onOpenDevice,
  onOpenAccess,
}: {
  onOpenDevice: () => void;
  onOpenAccess: () => void;
}) {
  const { account } = useAccount();
  // Export / passkey-count are custody-management verbs — only on the FullAvokClient
  // (self-custody). react-own-origin is always self-custody.
  const client = useSelfCustody();
  const signClient = client as unknown as SignNS;
  const [evmSigning, setEvmSigning] = useState(false);
  const [solSigning, setSolSigning] = useState(false);

  const [exportStep, setExportStep] = useState<ExportStep>("idle");
  const [exportErr, setExportErr] = useState<{ kind: SendErrorKind; message: string } | null>(null);
  const [exported, setExported] = useState<{ evm: string; solana: string } | null>(null);

  // The chain-verified number of ways into this wallet. NOT passkeyCount(), which counts local
  // credentials — it includes orphans (a credential whose slot write never landed) and so can never
  // be shown as a way in. The full roster lives on the Access screen.
  const [accessSlotCount, setAccessSlotCount] = useState<number | null>(null);

  const [message, setMessage] = useState("Hello from Avok demo");
  const [evmSig, setEvmSig] = useState<string | null>(null);
  const [solSig, setSolSig] = useState<string | null>(null);
  const [signErr, setSignErr] = useState<{ kind: SendErrorKind; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    // accessSlotCount() is chain-verified and keyless — no passkey ceremony, so it is safe to run on mount.
    client
      .accessSlotCount()
      .then((n) => {
        if (live) setAccessSlotCount(n);
      })
      .catch(() => {
        // A fresh, not-yet-delegated account has no vault contract on chain yet: zero access slots written.
        if (live) setAccessSlotCount(0);
      });
    return () => {
      live = false;
    };
  }, [client]);

  if (!account) return null;

  async function handleExport() {
    setExportErr(null);
    try {
      // #3 split the single `export()` into a ROOT key and a LEAF key. exportEvmKey is the root —
      // it alone restores the whole wallet, both chains (VISION §5) — and exportSolanaKey is shown
      // only because this screen renders the Solana address too. Each call is its own passkey gesture.
      const [evm, solana] = [await client.exportEvmKey(), await client.exportSolanaKey()];
      setExported({ evm, solana });
      setExportStep("done");
    } catch (e) {
      setExportErr(classifySendError(e));
    }
  }

  async function handleSignEvm() {
    setSignErr(null);
    setEvmSig(null);
    setEvmSigning(true);
    try {
      setEvmSig(await signClient.evm.signMessage({ message }));
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
      const { signature } = await signClient.solana.signMessage(message);
      setSolSig(signature);
    } catch (e) {
      setSignErr(classifySendError(e));
    } finally {
      setSolSigning(false);
    }
  }

  return (
    <Screen title="Account">
      <Text variant="label" tone="subtle" as="p" style={{ marginBottom: 14 }}>
        Managed on this device — keys and passkeys never leave this browser.
      </Text>

      {/* Addresses */}
      <Card>
        <div className="section-label">Identity</div>
        <div className="addr-row" style={{ marginBottom: 6 }}>
          <span className="addr-rail">EVM</span>
          <AddressText address={account.evm.address} copy />
        </div>
        <div className="addr-row" style={{ marginBottom: 10 }}>
          <span className="addr-rail">Solana</span>
          <AddressText address={account.solana.address} copy />
        </div>
      </Card>

      {/* Security: the trust surface. The number here is the CHAIN-VERIFIED access-slot count — never
          passkeyCount(), which counts local credentials and cannot tell an access slot from an orphan. */}
      <Card>
        <div className="section-label">Security</div>
        <ListRow
          title="Ways into this wallet"
          desc={
            accessSlotCount === null
              ? "Checking…"
              : `${accessSlotCount} — every one can reach your wallet key.`
          }
          chevron={false}
        />
        <div style={{ marginTop: 10 }}>
          <Stack gap="sm">
            <Button variant="ghost" onClick={onOpenAccess}>
              Who can reach this wallet
            </Button>
            <Button variant="ghost" onClick={onOpenDevice}>
              Manage devices
            </Button>
          </Stack>
        </div>
      </Card>

      {/* Sign a message */}
      <Card>
        <div className="section-label">Sign a message</div>
        <Field label="Message" value={message} onChange={setMessage} placeholder="Message to sign" />
        <div style={{ marginBottom: 10 }}>
          <Stack direction="row" gap="sm">
            <Button variant="ghost" onClick={handleSignEvm} disabled={evmSigning || !message.trim()}>
              {evmSigning ? "Signing…" : "Sign (EVM)"}
            </Button>
            <Button variant="ghost" onClick={handleSignSolana} disabled={solSigning || !message.trim()}>
              {solSigning ? "Signing…" : "Sign (Solana)"}
            </Button>
          </Stack>
        </div>
        {signErr && <ErrorNote kind={signErr.kind} message={signErr.message} />}
        {evmSig && (
          <div style={{ marginBottom: 8 }}>
            <div className="section-label">EVM signature</div>
            <AddressText address={evmSig} copy />
          </div>
        )}
        {solSig && (
          <div>
            <div className="section-label">Solana signature</div>
            <AddressText address={solSig} copy />
          </div>
        )}
      </Card>

      {/* Export — danger-gated */}
      <Card>
        <div className="section-label">Export wallet</div>
        {exportStep === "done" && exported ? (
          <>
            <Text variant="label" tone="danger" as="p" style={{ marginBottom: 10 }}>
              Anyone holding these keys controls the wallet. Store them securely and never share
              them.
            </Text>
            <div className="addr-row" style={{ marginBottom: 6 }}>
              <span className="addr-rail">EVM</span>
              <AddressText address={exported.evm} truncate={false} copy />
            </div>
            <div className="addr-row">
              <span className="addr-rail">Solana</span>
              <AddressText address={exported.solana} truncate={false} copy />
            </div>
          </>
        ) : exportStep === "confirm" ? (
          <>
            <Text variant="label" tone="subtle" as="p" style={{ marginBottom: 10 }}>
              This reveals your full recovery material to this app. Anyone with it controls the wallet.
              Make sure no one is watching your screen.
            </Text>
            <Stack direction="row" gap="sm">
              <Button variant="ghost" onClick={() => setExportStep("idle")}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleExport}>
                Confirm export
              </Button>
            </Stack>
          </>
        ) : (
          <>
            <Text variant="label" tone="subtle" as="p" style={{ marginBottom: 10 }}>
              Reveals the raw recovery material for this wallet — high risk.
            </Text>
            <Button variant="danger" onClick={() => setExportStep("confirm")}>
              Export wallet
            </Button>
          </>
        )}
        {exportErr && (
          <div style={{ marginTop: 8 }}>
            <ErrorNote kind={exportErr.kind} message={exportErr.message} />
          </div>
        )}
      </Card>
    </Screen>
  );
}
