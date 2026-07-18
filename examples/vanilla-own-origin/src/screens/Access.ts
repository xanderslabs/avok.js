/**
 * THE TRUST SURFACE — "who can reach this wallet" (framework-free port of react-own-origin's Access.tsx).
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
import { el } from "../core/el.js";
import type { Ctx } from "../core/app.js";
import { Button, Card, ErrorNote, Screen } from "../ui/index.js";
import { classifySendError, type SendErrorKind } from "@avokjs/core/helpers";
import type { FullAvokClient } from "@avokjs/vanilla";

/** Derived from the SDK so this screen cannot drift from the real roster shape. */
type AccessSlot = Awaited<ReturnType<FullAvokClient["listAccessSlots"]>>[number];

function addedOn(addedAt: number): string {
  // The chain reader returns 0 when the slot's timestamp can't be read — that is "unknown", not 1970.
  if (!addedAt) return "date unknown";
  return new Date(addedAt * 1000).toLocaleDateString();
}

const sub = { fontSize: "12px", color: "var(--text3)", lineHeight: "1.5" };

export function Access(ctx: Ctx): HTMLElement {
  const root = el("div");
  let s = {
    count: null as number | null,
    accessSlots: null as AccessSlot[] | null,
    listing: false,
    closing: null as string | null,
    confirmSlot: null as string | null,
    error: null as { kind: SendErrorKind; message: string } | null,
  };
  const set = (p: Partial<typeof s>) => {
    s = { ...s, ...p };
    root.replaceChildren(view());
  };

  // Chain-verified and keyless: the NUMBER of ways in costs no ceremony, so it is always honest and
  // always on screen, even if the user never reveals the domains.
  void ctx.client
    .accessSlotCount()
    .then((count) => set({ count }))
    .catch(() => set({ count: 0 }));

  async function reveal(): Promise<void> {
    set({ listing: true, error: null });
    try {
      set({ accessSlots: await ctx.client.listAccessSlots(), listing: false });
    } catch (e) {
      set({ listing: false, error: classifySendError(e) });
    }
  }

  async function closeAccessSlot(slotId: string): Promise<void> {
    set({ closing: slotId, error: null });
    try {
      await ctx.client.removeAccessSlot(slotId as `0x${string}`, { confirm: true });
      // Re-read both from chain rather than splicing local state: the count is the honest number and
      // it must never be inferred from a list we mutated ourselves.
      const accessSlots = await ctx.client.listAccessSlots();
      const count = await ctx.client.accessSlotCount();
      set({ closing: null, confirmSlot: null, accessSlots, count });
    } catch (e) {
      set({ closing: null, error: classifySendError(e) });
    }
  }

  function accessSlotNode(d: AccessSlot): Node {
    const confirming = s.confirmSlot === d.slotId;
    return el(
      "div",
      { style: { borderTop: "1px solid var(--line)", padding: "10px 0" } },
      el(
        "p",
        { style: { fontSize: "13px", color: "var(--text)", margin: "0 0 2px" } },
        // An unreadable or absent domain is normal — render it, never an error.
        d.rpId ?? "Unknown domain",
        d.isThisDevice
          ? el("span", { style: { fontSize: "11px", color: "var(--text3)", marginLeft: "8px" } }, "this device")
          : el("span"),
      ),
      el("p", { style: { fontSize: "11px", color: "var(--text3)", margin: "0 0 8px" } }, `Added ${addedOn(d.addedAt)}`),

      confirming
        ? el(
            "div",
            {},
            el(
              "p",
              { style: { fontSize: "12px", color: "var(--danger)", margin: "0 0 8px", lineHeight: "1.55" } },
              "Closing this access slot frees it so you can enrol another. It is housekeeping, not a security control: it cannot un-learn your key (a passkey that ever signed held the key in memory and could have kept it), its encrypted copy stays in this chain's history forever, and any passkey can close any other — they all sign as the same key. If this device is compromised, removing its access slot is not enough: move your funds to a new wallet, on both chains.",
            ),
            Button({
              variant: "primary",
              label: s.closing === d.slotId ? "Closing…" : "Close this access slot",
              disabled: s.closing !== null,
              onClick: () => void closeAccessSlot(d.slotId),
            }),
            Button({
              variant: "ghost",
              label: "Cancel",
              disabled: s.closing !== null,
              onClick: () => set({ confirmSlot: null }),
            }),
          )
        : Button({
            variant: "ghost",
            label: "Close this access slot",
            disabled: s.closing !== null,
            onClick: () => set({ confirmSlot: d.slotId }),
          }),
    );
  }

  function accessSlotsCard(): Node {
    if (s.accessSlots === null) {
      return Card(
        {},
        el("div", { class: "section-label" }, "The access slots"),
        el(
          "p",
          { style: { ...sub, margin: "0 0 10px" } },
          "Which domains enrolled these access slots is encrypted under your wallet key, so showing them asks for your passkey. Nothing is cached — this is read fresh every time.",
        ),
        Button({
          variant: "primary",
          label: s.listing ? "Reading…" : "Show which domains",
          disabled: s.listing,
          onClick: () => void reveal(),
        }),
        s.error && el("div", { style: { marginTop: "10px" } }, ErrorNote(s.error)),
      );
    }
    return Card(
      {},
      el("div", { class: "section-label" }, "The access slots"),
      s.accessSlots.length === 0
        ? el("p", { style: { ...sub, margin: "0" } }, "No access slots are recorded on the anchor chain for this wallet.")
        : el("div", {}, ...s.accessSlots.map(accessSlotNode)),
      s.error && el("div", { style: { marginTop: "10px" } }, ErrorNote(s.error)),
    );
  }

  function view(): Node {
    return Screen(
      { title: "Who can reach this wallet", onBack: () => ctx.go("account") },
      Card(
        {},
        el("div", { class: "section-label" }, "Ways into this wallet"),
        el(
          "p",
          { style: { fontSize: "19px", fontWeight: "700", color: "var(--text)", margin: "0 0 6px" } },
          s.count === null ? "…" : String(s.count),
        ),
        el(
          "p",
          { style: { ...sub, margin: "0" } },
          "Verified against the chain. Every one of them can reach your wallet key — adding an access slot grants that domain the ability to use your key, now or at any time later.",
        ),
      ),
      accessSlotsCard(),
      el(
        "p",
        { style: { ...sub, padding: "0 4px" } },
        "Access slots are listed for the anchor chain only — there is no cross-chain index, so an access slot written on another chain will not appear here.",
      ),
    );
  }

  root.replaceChildren(view());
  return root;
}
