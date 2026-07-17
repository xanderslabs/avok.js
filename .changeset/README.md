# Changesets

This folder holds release notes for each set of changes. Run `pnpm changeset` to record what you changed and what kind of version bump it needs. Run `pnpm version-packages` to apply pending changesets to package versions. The release workflow handles publishing on merge to `main`.

The nine published packages are fixed so they always release together with the same version.

The remaining packages are `private: true` engine/shared internals (bundled into the published facades) and are ignored by changesets.
