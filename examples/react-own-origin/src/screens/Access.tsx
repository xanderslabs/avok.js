import { useEffect, useState } from "react";
import { useSelfCustody } from "@avokjs/react";
import { classifySendError, type SendErrorKind } from "@avokjs/core/helpers";
import { Screen, Card, Button, ErrorNote, Text } from "../ui/index.js";

/**
 * THE TRUST SURFACE — "who can reach this wallet".
 *
 * Every access slot listed here can reach the wallet KEY. Enrolling one is a DEFERRED GRANT: any passkey that
 * can recover the wallet can obtain the key, whenever it likes. No copy on this screen may suggest a
 * access slot "learns nothing" or is somehow limited.
 *
 * Two different numbers, and the difference is the whole point:
 *  - `accessSlotCount()`    — chain-verified. THIS is "ways into this wallet". Keyless, so it loads on mount.
 *  - `passkeyCount()` — local credentials. Counts ORPHANS (a credential whose slot write never landed)
 *                       and so can NEVER be shown as a way in. This screen does not render it.
 *
 * `listAccessSlots()` costs one passkey ceremony (the enrolling domain is encrypted under the wallet key and
 * only the sandbox may hold it), so it sits behind an explicit button rather than firing a biometric
 * prompt the instant the screen opens. Nothing is cached — deliberately.
 */
type Client = ReturnType<typeof useSelfCustody>;
/** Derived from the SDK so this screen cannot drift from the real roster shape. */
type AccessSlot = Awaited<ReturnType<Client["listAccessSlots"]>>[number];

function addedOn(addedAt: number): string {
  // The chain reader returns 0 when the slot's timestamp can't be read — that is "unknown", not 1970.
  if (!addedAt) return "date unknown";
  return new Date(addedAt * 1000).toLocaleDateString();
}

export function Access({ onBack }: { onBack: () => void }) {
  const client = useSelfCustody();

  const [count, setCount] = useState<number | null>(null);
  const [accessSlots, setAccessSlots] = useState<AccessSlot[] | null>(null);
  const [listing, setListing] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [confirmSlot, setConfirmSlot] = useState<string | null>(null);
  const [err, setErr] = useState<{ kind: SendErrorKind; message: string } | null>(null);

  // Chain-verified and keyless: the NUMBER of ways in costs no ceremony, so it is always honest and
  // always on screen, even if the user never reveals the domains.
  useEffect(() => {
    let live = true;
    client
      .accessSlotCount()
      .then((n) => live && setCount(n))
      .catch(() => live && setCount(null));
    return () => {
      live = false;
    };
  }, [client]);

  async function reveal() {
    setErr(null);
    setListing(true);
    try {
      setAccessSlots(await client.listAccessSlots());
    } catch (e) {
      setErr(classifySendError(e));
    } finally {
      setListing(false);
    }
  }

  async function closeAccessSlot(slotId: string) {
    setErr(null);
    setClosing(slotId);
    try {
      await client.removeAccessSlot(slotId as `0x${string}`, { confirm: true });
      setConfirmSlot(null);
      // Re-read both from chain rather than splicing local state: the count is the honest number and
      // it must never be inferred from a list we mutated ourselves.
      setAccessSlots(await client.listAccessSlots());
      setCount(await client.accessSlotCount());
    } catch (e) {
      setErr(classifySendError(e));
    } finally {
      setClosing(null);
    }
  }

  return (
    <Screen title="Who can reach this wallet" onBack={onBack}>
      <Card>
        <div className="section-label">Ways into this wallet</div>
        <Text variant="display" as="p" style={{ margin: "0 0 6px" }}>
          {count === null ? "…" : count}
        </Text>
        <Text variant="label" tone="subtle" as="p" style={{ margin: 0 }}>
          Verified against the chain. Every one of them can reach your wallet key — adding an access slot grants that
          domain the ability to use your key, now or at any time later.
        </Text>
      </Card>

      <Card>
        <div className="section-label">The access slots</div>
        {accessSlots === null ? (
          <>
            <Text variant="label" tone="subtle" as="p" style={{ marginBottom: 10 }}>
              Which domains enrolled these access slots is encrypted under your wallet key, so showing them asks for
              your passkey. Nothing is cached — this is read fresh every time.
            </Text>
            <Button variant="primary" onClick={reveal} disabled={listing}>
              {listing ? "Reading…" : "Show which domains"}
            </Button>
          </>
        ) : accessSlots.length === 0 ? (
          <Text variant="label" tone="subtle" as="p" style={{ margin: 0 }}>
            No access slots are recorded on the anchor chain for this wallet.
          </Text>
        ) : (
          accessSlots.map((d) => (
            <div key={d.slotId} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
              <Text variant="body" as="p" style={{ margin: "0 0 2px" }}>
                {/* An unreadable or absent domain is normal — render it, never an error. */}
                {d.rpId ?? "Unknown domain"}
                {d.isThisDevice && (
                  <Text variant="micro" tone="subtle" as="span" style={{ marginLeft: 8 }}>
                    this device
                  </Text>
                )}
              </Text>
              <Text variant="micro" tone="subtle" as="p" style={{ margin: "0 0 8px" }}>
                Added {addedOn(d.addedAt)}
              </Text>

              {confirmSlot === d.slotId ? (
                <div>
                  <Text variant="label" tone="danger" as="p" style={{ margin: "0 0 8px" }}>
                    Closing this access slot frees it so you can enrol another. It is housekeeping, not a security
                    control:
                    <br />• It cannot un-learn your key. A passkey that ever signed held the key in memory and could
                    have kept it.
                    <br />• Its encrypted copy stays in this chain's history forever.
                    <br />• Any passkey can close any other — they all sign as the same key.
                    <br />
                    <strong>
                      If this device is compromised, removing its access slot is not enough. Move your funds to a new
                      wallet, on both chains.
                    </strong>
                  </Text>
                  <Button variant="primary" onClick={() => closeAccessSlot(d.slotId)} disabled={closing !== null}>
                    {closing === d.slotId ? "Closing…" : "Close this access slot"}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmSlot(null)} disabled={closing !== null}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmSlot(d.slotId)} disabled={closing !== null}>
                  Close this access slot
                </Button>
              )}
            </div>
          ))
        )}
        {err && (
          <div style={{ marginTop: 10 }}>
            <ErrorNote kind={err.kind} message={err.message} />
          </div>
        )}
      </Card>

      <Text variant="micro" tone="subtle" as="p" style={{ padding: "0 4px" }}>
        Access slots are listed for the anchor chain only — there is no cross-chain index, so an access slot written on
        another chain will not appear here.
      </Text>
    </Screen>
  );
}
