# Changesets

This folder holds release notes for each set of changes. Run `pnpm changeset` to record what you changed and what kind of version bump it needs. Run `pnpm version-packages` to apply pending changesets to package versions. The release workflow handles publishing on merge to `main`.

The published packages — `@avokjs/core`, `@avokjs/react`, `@avokjs/react-native`, `@avokjs/contracts` and `@avokjs/vault` — are fixed so they always release together with the same version. A new publishable package MUST be added to `fixed` in `config.json`, or it silently versions on its own track.

## Which bump to write

**Pre-1.0, which is where Avok is until the audit:** the SECOND digit carries breaking changes and
the THIRD carries everything else. So a breaking change is a `minor` (`0.1.0` to `0.2.0`), and a
feature or a fix is a `patch` (`0.2.0` to `0.2.1`). Never write `major` before 1.0.

This is not a house style. Semver reserves `0.y.z` for initial development, and npm's caret already
reads it this way: `^0.1.0` will take `0.1.9` but refuses `0.2.0`, so bumping the minor is what
actually warns an installed consumer that something broke. Writing `major` instead jumps straight to
`1.0.0`, which claims a stability the pre-audit code does not have.

| Change | Pre-1.0 (now) | Post-1.0 |
| --- | --- | --- |
| Breaking | `minor` → 0.2.0 | `major` → 2.0.0 |
| New feature | `patch` → 0.1.1 | `minor` → 1.1.0 |
| Fix | `patch` → 0.1.1 | `patch` → 1.0.1 |

**1.0.0 is the audit.** Cutting it is a deliberate act, not the result of a changeset: it is the
version that says the surface has been reviewed. After it, normal semver applies and `major` is
available again.
