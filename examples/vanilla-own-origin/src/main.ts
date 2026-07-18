/**
 * App bootstrap — builds the OWN-ORIGIN (self-custody) client from src/config.ts,
 * then mounts the framework-free app. This is the single file a static host
 * serves; everything it needs ships in this dir + the published SDK.
 */
import "./theme/tokens.css";
import "./ui/ui.css";

import { createAvokClient, createOwnOriginConnection } from "@avokjs/core";
import type { FullAvokClient } from "@avokjs/core";
import { config } from "./config.js";
import { createCtx, mountApp } from "./core/app.js";
import { Onboard } from "./screens/Onboard.js";
import { Home } from "./screens/Home.js";
import { Send } from "./screens/Send.js";
import { Account } from "./screens/Account.js";
import { Device } from "./screens/Device.js";
import { Access } from "./screens/Access.js";

const connection = createOwnOriginConnection({ rpId: config.rpId, operatorName: config.operatorName, anchorChainId: config.anchorChainId });
const client = createAvokClient({
  connection,
  paymasterUrl: config.paymasterUrl,
  bundlerUrl: config.bundlerUrl,
  koraUrl: config.koraUrl,
}) as FullAvokClient;

const ctx = createCtx(client);
mountApp(document.getElementById("app")!, ctx, {
  onboard: Onboard,
  home: Home,
  send: Send,
  account: Account,
  device: Device,
  access: Access,
});
