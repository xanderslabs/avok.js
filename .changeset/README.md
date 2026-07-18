# Changesets

This folder holds release notes for each set of changes. Run `pnpm changeset` to record what you changed and what kind of version bump it needs. Run `pnpm version-packages` to apply pending changesets to package versions. The release workflow handles publishing on merge to `main`.

The four published packages — `@avokjs/core`, `@avokjs/react`, `@avokjs/react-native`, `@avokjs/contracts` — are fixed so they always release together with the same version.

Everything the SDK used to split across private engine packages now lives inside `@avokjs/core` as domain folders + subpaths, so there are no bundled private internals left to ignore. The `examples/*` apps are `private: true` and never publish.
