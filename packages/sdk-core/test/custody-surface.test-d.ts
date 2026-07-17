// Compile-time surface assertions. This file is typechecked by `tsc --noEmit`
// (it is NOT run). Each @ts-expect-error asserts a member is ABSENT; if the
// member exists, the directive becomes an unused-directive error and tsc fails.
import type { FullAvokClient, UseOnlyAvokClient } from "../src/client/client.js";

declare const full: FullAvokClient;
declare const useOnly: UseOnlyAvokClient;

// Full (own-origin) client HAS management verbs — these must type-check:
void full.exportEvmKey;
void full.exportSolanaKey;
void full.enrollAccessSlot;
void full.enrollAccessSlot.viaPairing;
void full.create;

// #6: the subname surface left the core entirely — NEITHER client has it any more.
// Registration lives in @avokjs/subnames (build-only) and resolution in
// @avokjs/helpers, so these must be absent even on the FULL own-origin client.
// @ts-expect-error the subname add-on owns registration, not the core client
void full.registerSubname;
// @ts-expect-error the subname add-on owns registration, not the core client
void full.registerSolanaName;
// @ts-expect-error resolution lives in @avokjs/helpers, not the core client
void full.subname;

// Use-only (shared-origin) client must NOT have management verbs:
// @ts-expect-error shared-origin client has no exportEvmKey
void useOnly.exportEvmKey;
// @ts-expect-error shared-origin client has no enrollAccessSlot
void useOnly.enrollAccessSlot;
// @ts-expect-error shared-origin client has no create
void useOnly.create;
// @ts-expect-error shared-origin client has no registerSubname
void useOnly.registerSubname;
// @ts-expect-error resolution lives in @avokjs/helpers, not the core client
void useOnly.subname;

// Both share the use-only surface:
void useOnly.account;
void useOnly.status;
void useOnly.logout;
void useOnly.isActivated;
