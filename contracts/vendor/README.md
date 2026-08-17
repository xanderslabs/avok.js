# vendor/

Third-party Solidity that is compiled into this project but is NOT ours to change.

**Nothing here may be edited.** A patched dependency is an unaudited dependency, and two of these
carry audits that are the whole reason Avok inherits them rather than writing its own. If something
needs to change, subclass it in `src/`.

Vendored rather than installed because each of these is unreachable by the normal route: the npm
tree pulls dependencies this repo has no use for, and one link in it was broken outright (see
below). Every file was fetched from a published artifact and verified before being copied here.

| Path | Upstream | Version | Verified |
|---|---|---|---|
| `account-abstraction/` | eth-infinitism/account-abstraction | (pre-existing) | interfaces only |
