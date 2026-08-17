// Compile-time surface assertions. This file is typechecked by `tsc --noEmit`
// (it is NOT run). Each @ts-expect-error asserts a member is ABSENT; if the
// member exists, the directive becomes an unused-directive error and tsc fails.
import type { FullAvokClient, UseOnlyAvokClient } from "../../src/client/client.js";

declare const full: FullAvokClient;
declare const useOnly: UseOnlyAvokClient;

// Full (own-origin) client HAS management verbs — these must type-check:
void full.exportEvmKey;
void full.enrollAccessSlot;
void full.enrollAccessSlot.viaPairing;
void full.create;

// Name registration is out of scope for Avok — NEITHER client has it. Only resolution
// remains (in @avokjs/core/helpers), so these registration verbs must be absent even on the
// FULL own-origin client.
// @ts-expect-error registration is out of scope; the core client never exposes it
void full.registerName;
// @ts-expect-error a resolved name is not wallet state; resolve it via @avokjs/core/helpers
void full.name;

// Use-only (shared-origin) client must NOT have management verbs:
// @ts-expect-error shared-origin client has no exportEvmKey
void useOnly.exportEvmKey;
// @ts-expect-error shared-origin client has no enrollAccessSlot
void useOnly.enrollAccessSlot;
// @ts-expect-error shared-origin client has no create
void useOnly.create;
// @ts-expect-error registration is out of scope; the shared-origin client never exposes it
void useOnly.registerName;
// @ts-expect-error a resolved name is not wallet state; resolve it via @avokjs/core/helpers
void useOnly.name;

// Both share the use-only surface:
void useOnly.account;
void useOnly.status;
void useOnly.logout;
void useOnly.isActivated;
