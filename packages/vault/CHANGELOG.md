# @avokjs/vault

## 0.2.0

### Minor Changes

- cb8c699: New package: `@avokjs/vault`, the build-time CLI that emits and serves the operator's hardened Vault
  page.

  It is deliberately a separate package rather than a subcommand of `@avokjs/core`. The CLI needs a
  bundler and a static server; core is installed by every app that ships the browser SDK, and none of
  them should carry build tooling in their install graph to get it.

  This release is the scaffold: the `avok-vault` binary and its subcommand dispatch. `init`, `build`,
  `dev` and `check` land in the releases that follow.

### Patch Changes

- Updated dependencies [cb8c699]
- Updated dependencies [cb8c699]
  - @avokjs/core@0.2.0
