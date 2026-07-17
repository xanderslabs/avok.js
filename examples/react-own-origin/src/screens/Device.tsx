import { useState } from "react";
import { useSelfCustody } from "@avokjs/react";
import { classifySendError, type SendErrorKind } from "@avokjs/helpers";
import { Screen, Card, Button, ErrorNote, Text } from "../ui/index.js";
import { AuthorizeFlow } from "../pairing/PairDevice.js";

type View = "menu" | "pair";

export function Device({ onBack }: { onBack: () => void }) {
  const client = useSelfCustody();
  const [view, setView] = useState<View>("menu");
  // #3 deleted `read.passkeyCount()` — the sync, LOCAL credential count. There is no getter for it
  // any more, and accessSlotCount() is not a substitute (it counts chain access slots, which is the
  // very distinction the copy below draws). So it starts unknown and is filled by enrolment, which
  // still returns it.
  const [passkeyCount, setPasskeyCount] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<{ kind: SendErrorKind; message: string } | null>(null);

  async function handleAddPasskey() {
    setAddErr(null);
    setAdding(true);
    try {
      const { passkeyCount } = await client.enrollAccessSlot();
      setPasskeyCount(passkeyCount);
    } catch (e) {
      setAddErr(classifySendError(e));
    } finally {
      setAdding(false);
    }
  }

  if (view === "pair") {
    return (
      <Screen title="Export to a device" onBack={() => setView("menu")}>
        <Text variant="label" tone="subtle" as="p" style={{ margin: "0 0 14px" }}>
          Provision this wallet onto a NEW device: it runs "Set up this device" and shows a QR — scan it
          here, then show it yours. You'll confirm a 6-digit code matches on both before anything is granted.
        </Text>
        <AuthorizeFlow />
      </Screen>
    );
  }

  return (
    <Screen title="Devices" onBack={onBack}>
      <Text variant="label" tone="subtle" as="p" style={{ marginBottom: 14 }}>
        Managed on this device — keys and passkeys never leave this browser.
      </Text>

      <Card>
        <div className="section-label">Add a passkey (same device)</div>
        <Text variant="label" tone="subtle" as="p" style={{ marginBottom: 10 }}>
          Enrol another passkey for this wallet on THIS device (e.g. a second provider or a hardware key).
          It's a secondary — it can't derive your key by itself, so an encrypted copy is written on chain:
          one transaction, paid by the wallet.
        </Text>
        {/* A LOCAL credential count — it cannot tell an access slot from an orphan (a credential whose slot
            write never landed opens nothing). The honest "ways in" number is accessSlotCount(), on Access. */}
        {passkeyCount !== null && (
          <Text variant="label" tone="subtle" as="p" style={{ marginBottom: 10 }}>
            {passkeyCount} credential(s) on this device — not the same as access slots. See "Who can reach this
            wallet" for the chain-verified count.
          </Text>
        )}
        <Button variant="ghost" onClick={handleAddPasskey} disabled={adding}>
          {adding ? "Adding…" : "Add a passkey"}
        </Button>
        {addErr && (
          <div style={{ marginTop: 8 }}>
            <ErrorNote kind={addErr.kind} message={addErr.message} />
          </div>
        )}
      </Card>

      <Card>
        <div className="section-label">Export to a device (cross device)</div>
        <Text variant="label" tone="subtle" as="p" style={{ marginBottom: 10 }}>
          Provision this wallet onto a DIFFERENT device you own — via a SAS-confirmed handshake. Run this
          on your existing device; the new device runs the matching import.
        </Text>
        {/* Enrolling a passkey is a DEFERRED GRANT: the other device can obtain the wallet key whenever
            it likes. Removing its access slot later is housekeeping (it frees capacity); it cannot un-learn a
            key the passkey already had. Never imply removal undoes the grant. */}
        <Text variant="label" tone="danger" as="p" style={{ marginBottom: 10 }}>
          ⚠ This grants the other device the ability to use your wallet key — now, or at any time later.
          Only pair a device you control. You can remove its access slot afterwards (see "Who can reach this
          wallet"), but that only frees the slot: it cannot un-learn a key the device already had. If a
          device is lost or compromised, move your funds to a new wallet.
        </Text>
        <Button variant="primary" onClick={() => setView("pair")}>Export to a device</Button>
      </Card>
    </Screen>
  );
}
