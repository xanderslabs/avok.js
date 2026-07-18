import { useState } from "react";
import { useCreate, useLogin } from "@avokjs/react";
import { BrandMark, Button, Card, ErrorNote, Icon, Screen, Stack, Text } from "../ui/index.js";
import { classifySendError } from "@avokjs/core/helpers";
import { SetupFlow } from "../pairing/PairDevice.js";
import { isReturning, markReturning } from "../returning.js";

/**
 * Entry screen shown while there's no account.
 *
 * The user is never asked to reason about credentials. They answer one question — do I have a
 * wallet, or not — and, if they do, one follow-up: is it available here?
 *
 *  - RETURNING (a wallet was established in this browser before) → "Sign in". One button.
 *  - COLD → two options: "Create a wallet" (a fresh credential mints a NEW, separate wallet) or
 *    "Use an existing wallet", which branches:
 *      · "Open it"                       → continue(); the credential is already available here
 *                                          (synced, or this device was set up earlier). Derives the
 *                                          key from the credential itself — no network call.
 *      · "Set it up from another device" → the enroller half of the two-party ceremony, for when
 *                                          the credential does NOT sync here. This MUST live at
 *                                          sign-in: a device with no wallet has no settings screen
 *                                          to host it. The GRANTING half ("Export to a device")
 *                                          lives in settings, on the live wallet.
 *
 * Create/Open populate the account via AvokProvider; the shell re-renders to the primary nav once
 * `useAccount()` resolves. There is no import: with no seed to type in, there's nothing to import.
 */
type View = "signin" | "cold" | "existing" | "setup";

export function Onboard() {
  const [view, setView] = useState<View>(() => (isReturning() ? "signin" : "cold"));
  const { create, pending: creating, error: createError } = useCreate();
  // #3 renamed the continuation verb `continue → login` (and `useContinue → useLogin`).
  const { login: continueAccount, pending: continuing, error: continueError } = useLogin();

  const error = createError ?? continueError;

  async function handleCreate() {
    try {
      await create();
      markReturning();
    } catch {
      /* surfaced via `error` below */
    }
  }

  async function handleOpen() {
    try {
      await continueAccount();
      markReturning();
    } catch {
      /* surfaced via `error` below */
    }
  }

  if (view === "setup") {
    return (
      <Screen title="Set up this device" onBack={() => setView("existing")}>
        <Text variant="label" tone="subtle" as="p" style={{ margin: "0 0 12px" }}>
          Bring your wallet to this device from the one that already has it. This is the new-device half
          of a two-part flow: on your other device open Settings → "Export to a device", then follow along
          here. The two devices talk over an end-to-end-encrypted channel, and you'll compare a 6-digit
          code on both screens before anything is granted.
        </Text>
        <Card style={{ marginBottom: 14 }}>
          <Text variant="label" tone="caution" as="p" style={{ margin: 0 }}>
            This costs one on-chain transaction, paid by the wallet: this device gets its own encrypted
            key copy stored on chain, and that copy is what lets it sign in later. A wallet with no funds
            can't add a device yet.
          </Text>
        </Card>
        {/* On success `complete()` populates the account and the shell swaps to the app; onDone just
            returns to the branch for the failure-then-cancel case. */}
        <SetupFlow onDone={() => setView("existing")} />
      </Screen>
    );
  }

  if (view === "existing") {
    return (
      <Screen title="Use an existing wallet" onBack={() => setView("cold")}>
        <Text variant="body" tone="subtle" as="p" style={{ margin: "0 0 16px" }}>
          Is your wallet already available on this device?
        </Text>
        <Stack gap="sm">
          <Button variant="primary" onClick={handleOpen} disabled={continuing}>
            {continuing ? "Signing in…" : "Open it"}
          </Button>
          <Button variant="ghost" icon={<Icon name="device" size={15} />} onClick={() => setView("setup")}>
            Set it up from another device
          </Button>
        </Stack>
        <Text variant="micro" tone="subtle" as="p" style={{ margin: "12px auto 0", maxWidth: "34ch" }}>
          Setting it up from another device costs one on-chain transaction, paid by the wallet.
        </Text>
        {error && <ErrorNote {...classifySendError(error)} />}
      </Screen>
    );
  }

  if (view === "signin") {
    return (
      <div style={{ padding: "30px 22px 22px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <BrandMark size={50} />
        </div>
        <Text variant="display" as="h3" style={{ margin: "0 0 6px" }}>
          Welcome back
        </Text>
        <Text
          variant="body"
          tone="subtle"
          as="p"
          style={{ margin: "0 0 20px", maxWidth: "32ch", marginInline: "auto" }}
        >
          Your wallet is on this device. Sign in to open it.
        </Text>

        <Stack gap="sm">
          <Button variant="primary" onClick={handleOpen} disabled={continuing}>
            {continuing ? "Signing in…" : "Sign in"}
          </Button>
          <Button variant="ghost" onClick={() => setView("cold")} disabled={continuing}>
            Use a different wallet
          </Button>
        </Stack>

        {error && <ErrorNote {...classifySendError(error)} />}
      </div>
    );
  }

  return (
    <div style={{ padding: "30px 22px 22px", textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <BrandMark size={50} />
      </div>
      <Text variant="display" as="h3" style={{ margin: "0 0 6px" }}>
        Welcome to Avok
      </Text>
      <Text
        variant="body"
        tone="subtle"
        as="p"
        style={{ margin: "0 0 20px", maxWidth: "32ch", marginInline: "auto" }}
      >
        Keys live on this device — no custodian holds your funds.
      </Text>

      <Stack gap="sm">
        <Button variant="primary" icon={<Icon name="plus" size={15} />} onClick={handleCreate} disabled={creating}>
          {creating ? "Creating your wallet…" : "Create a wallet"}
        </Button>
        <Button variant="ghost" onClick={() => setView("existing")} disabled={creating}>
          Use an existing wallet
        </Button>
      </Stack>

      <Text variant="micro" tone="subtle" as="p" style={{ margin: "12px auto 0", maxWidth: "34ch" }}>
        Create makes a new, separate wallet.
      </Text>

      {error && <ErrorNote {...classifySendError(error)} />}
    </div>
  );
}
