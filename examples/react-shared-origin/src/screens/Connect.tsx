import { useState } from "react";
import { useAvok } from "@avokjs/react";
import { classifySendError } from "@avokjs/helpers";
import { config } from "../config.js";
import { BrandMark, Button, ErrorNote, Icon, Stack, Text } from "../ui/index.js";

// Operator name is derived from the auth origin's host — this app never
// renders a hardcoded brand for the operator.
function operatorName(authOrigin: string): string {
  try {
    return new URL(authOrigin).hostname;
  } catch {
    return authOrigin;
  }
}

/**
 * Shared-origin entry — "Continue with [operator]". Continue runs the ceremony in
 * the auth-origin popup; no key material crosses the boundary. Shared-origin is
 * use-only: creating and managing a wallet happens at the operator's own
 * (Own-origin) app, not here — "New here?" opens that app in a new tab.
 */
export function Connect({ onConnected }: { onConnected: () => void }) {
  // #3 renamed the use-only sign-in verb `continue → login` and removed the `useContinue` hook; drive
  // `client.login()` directly with local pending/error state (the auth-origin popup runs the ceremony).
  const client = useAvok();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const operator = operatorName(config.authOrigin);

  async function handleContinue() {
    setPending(true);
    setError(null);
    try {
      await client.login();
      onConnected();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ padding: "30px 22px 22px", textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <BrandMark size={50} />
      </div>
      <Text variant="display" as="h3" style={{ margin: "0 0 6px" }}>
        Continue with {operator}
      </Text>
      <Text variant="body" tone="subtle" as="p" style={{ margin: "0 0 20px", maxWidth: "32ch", marginInline: "auto" }}>
        Sign in to {operator} to use the same wallet here. Keys stay at {operator} — this app only
        receives signatures.
      </Text>

      <Button variant="primary" icon={<Icon name="external" size={15} />} onClick={handleContinue} disabled={pending}>
        {pending ? "Confirm in the popup…" : `Continue with ${operator}`}
      </Button>
      {/* `error != null`, not `error &&`: the state is `unknown`, so a bare `&&` leaks `unknown`
          into the JSX (React cannot render it) rather than narrowing to a boolean. */}
      {error != null && (
        <div style={{ marginTop: 10 }}>
          <ErrorNote {...classifySendError(error)} />
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <Stack gap="sm">
          <Button
            variant="ghost"
            icon={<Icon name="external" size={13} />}
            onClick={() => config.managementUrl && window.open(config.managementUrl, "_blank", "noopener")}
            disabled={!config.managementUrl}
          >
            New here? Set up at {operator} ↗
          </Button>
        </Stack>
        <Text variant="micro" tone="subtle" as="p" style={{ margin: "8px auto 0", maxWidth: "34ch" }}>
          Creating and managing a wallet happens in {operator}'s own app — this app only signs in.
        </Text>
        {!config.managementUrl && (
          <Text variant="micro" tone="danger" as="p" style={{ margin: "6px 0 0" }}>
            Sign-up isn't currently available for this app.
          </Text>
        )}
      </div>

      <Text variant="micro" tone="subtle" mono as="div" style={{ marginTop: 16 }}>
        Shared-origin · opens {operator}
      </Text>
    </div>
  );
}
