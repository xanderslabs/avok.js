---
"@avokjs/react-native": patch
"@avokjs/core": patch
---

Drop `@noble/hashes` and `@scure/base` from `dependencies`. Both were genuinely dead after the D8
migration deleted the PRF-blob/SAS code that used them (re-verified against the built `dist`, not
just source grep, since a stale comment in `runtime-deps.test.ts` had insisted all three were
load-bearing transitive imports for Metro). `@noble/curves` stays: secp256k1 signing is still live.
