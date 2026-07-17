import { AvokProvider, useAccount, useLogout } from "@avokjs/react";
import { ThemeProvider } from "./theme/ThemeProvider.js";
import { useAvokClient } from "./useAvokClient.js";
import { useNav, type Screen } from "./nav.js";
import { Onboard } from "./screens/Onboard.js";
import { Home } from "./screens/Home.js";
import { Send } from "./screens/Send.js";
import { Account } from "./screens/Account.js";
import { Subname } from "./screens/Subname.js";
import { Device } from "./screens/Device.js";
import { Access } from "./screens/Access.js";
import { Button } from "./ui/index.js";

const NAV: { id: Screen; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "send", label: "Send" },
  { id: "account", label: "Account" },
];

function Shell() {
  const { account } = useAccount();
  const { logout } = useLogout();
  const { screen, setScreen } = useNav();

  if (!account) return <Onboard />;

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
      {screen === "account" && (
        <>
          <Account
            onOpenSubname={() => setScreen("subname")}
            onOpenDevice={() => setScreen("device")}
            onOpenAccess={() => setScreen("access")}
          />
          <div style={{ padding: "0 16px 16px" }}>
            <Button variant="ghost" onClick={() => logout()}>
              Log out
            </Button>
          </div>
        </>
      )}
      {screen === "subname" && <Subname onBack={() => setScreen("account")} />}
      {screen === "device" && <Device onBack={() => setScreen("account")} />}
      {screen === "access" && <Access onBack={() => setScreen("account")} />}
    </div>
  );
}

export default function App() {
  const client = useAvokClient();
  return (
    <ThemeProvider>
      <AvokProvider client={client}>
        <Shell />
      </AvokProvider>
    </ThemeProvider>
  );
}
