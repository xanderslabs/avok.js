import { AvokProvider, useAccount } from "@avokjs/react";
import { ThemeProvider } from "./theme/ThemeProvider.js";
import { useSharedOriginClient } from "./useSharedOriginClient.js";
import { useNav, type Screen } from "./nav.js";
import { config } from "./config.js";
import { Connect } from "./screens/Connect.js";
import { Home } from "./screens/Home.js";
import { Send } from "./screens/Send.js";
import { Account } from "./screens/Account.js";
import { EmptyState, Text } from "./ui/index.js";

const NAV: { id: Screen; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "send", label: "Send" },
  { id: "account", label: "Account" },
];

// Operator name is derived from the auth origin's host — this app never
// renders a hardcoded brand for the operator.
function operatorName(authOrigin: string): string {
  try {
    return new URL(authOrigin).hostname;
  } catch {
    return authOrigin;
  }
}

function Shell() {
  const { account } = useAccount();
  const { screen, setScreen } = useNav();

  // No shell logout: a shared-origin app holds no custody, so Disconnect lives on Account.
  if (!account) return <Connect onConnected={() => setScreen("home")} />;

  return (
    <div>
      <div className="navbar">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={screen === n.id ? "nav-btn nav-active" : "nav-btn"}
            onClick={() => setScreen(n.id)}
          >
            {n.label}
          </button>
        ))}
      </div>
      {screen === "home" && <Home onSend={() => setScreen("send")} />}
      {screen === "send" && <Send />}
      {screen === "account" && <Account onLoggedOut={() => setScreen("home")} />}
    </div>
  );
}

function Connecting() {
  const { client, loading, error } = useSharedOriginClient();
  const operator = operatorName(config.authOrigin);

  if (loading) return <EmptyState loading>Connecting to {operator}…</EmptyState>;

  if (error || !client) {
    return (
      <div style={{ padding: 24 }}>
        <Text variant="body" tone="danger" as="p" style={{ margin: 0 }}>
          Couldn't reach {operator}.
        </Text>
        <Text variant="label" tone="subtle" as="p" style={{ margin: "6px 0 0" }}>
          The sign-in service isn't reachable right now. Check your connection and try again.
        </Text>
      </div>
    );
  }

  return (
    <AvokProvider client={client}>
      <Shell />
    </AvokProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Connecting />
    </ThemeProvider>
  );
}
