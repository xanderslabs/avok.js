export const VERSION = "0.0.1";

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

export {
  memoryStorage,
  saveAccount,
  loadAccount,
  clearAccount,
} from "./storage.js";
export { createSharedOriginConnection } from "./connection.js";
export { UserRejectedError, throwIfSignError } from "./sign-errors.js";
export type { SharedOriginConnection } from "./connection.js";

export { createWebChannel } from "./channels/web.js";
export type { SigningChannel, ChannelRequest, ChannelResult } from "./channels/port.js";
