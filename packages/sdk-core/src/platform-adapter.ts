/**
 * PlatformAdapter combines the three core abstractions for SDK usage.
 * Implementations must provide all three components to enable both
 * shared-origin (SigningChannel) and own-origin (PasskeyAdapter) authentication paths
 * plus a storage backend.
 */

export type { SigningChannel } from "@avokjs/network";
export type { PasskeyAdapter } from "@avokjs/wallet-core";
export type { StorageAdapter } from "./storage.js";

import type { SigningChannel } from "@avokjs/network";
import type { PasskeyAdapter } from "@avokjs/wallet-core";
import type { StorageAdapter } from "./storage.js";

export interface PlatformAdapter {
  signingChannel: SigningChannel;   // shared-origin path
  passkeyAdapter: PasskeyAdapter;   // own-origin path
  storage: StorageAdapter;
}
