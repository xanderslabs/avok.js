---
"@avokjs/vault": minor
---

New package: `@avokjs/vault`, the build-time CLI that emits and serves the operator's hardened Vault
page.

It is deliberately a separate package rather than a subcommand of `@avokjs/core`. The CLI needs a
bundler and a static server; core is installed by every app that ships the browser SDK, and none of
them should carry build tooling in their install graph to get it.

This changeset originally described the scaffold alone (the `avok-vault` binary and its subcommand
dispatch, with `init`/`build`/`dev`/`check` landing later). All four now ship in this same
not-yet-released first version — see the accompanying changeset for the CSP/RPC-pinning behavior
`build`/`check` enforce.
