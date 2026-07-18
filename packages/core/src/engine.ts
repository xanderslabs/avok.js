// @avokjs/core/engine — the platform-agnostic entry (no browser globals). React Native builds on
// this and injects its own native passkey/storage adapters.
//
// Core is already platform-agnostic (the client takes an injected connection; the browser platform
// wiring lives in the facades, not here), so for now this mirrors the main entry. When a browser
// default is folded into the main `@avokjs/core` export (vanilla collapse), this stays the
// globals-free subset RN imports.
export * from "./index.js";
