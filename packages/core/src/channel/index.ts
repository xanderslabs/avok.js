export type {
  Signer,
  SignRequest,
  SignResult,
  SignedAuthorizationLike,
  AuthorizationTriple,
  SiweParams,
  SharedAccount,
} from "./types.js";

export type { StorageAdapter } from "./storage.js";

// The account persistence helpers (saveAccount/loadAccount/clearAccount) stay module-private — the
// connection owns persistence; consumers pass a StorageAdapter, they don't call these directly.
export { memoryStorage } from "./storage.js";
export { createSharedOriginConnection } from "./connection.js";
export { UserRejectedError } from "./sign-errors.js";
export type { SharedOriginConnection } from "./connection.js";

export { createWebChannel } from "./channels/web.js";
export type { SigningChannel, ChannelRequest, ChannelResult } from "./channels/port.js";
