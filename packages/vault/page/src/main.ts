import { mountAuthPopup } from "@avokjs/core/auth-popup";
import { readConfig } from "./config.js";

// One page — the wallet-sandbox popup. It posts `ready`, then services whatever the opener asks
// (authorize | sign) from the SAME passkey/sandbox setup (the two /authorize and /sign pages collapsed
// into one). Config is baked into this page at build time by scripts/inline-app.mjs (clone-and-own;
// there is no server). readConfig() fails loud on a missing rpId — K = HKDF(PRF(credential, rpId)),
// so an unset or inferred rpId is a wallet-drain defect, not a convenience gap.
mountAuthPopup(readConfig());
