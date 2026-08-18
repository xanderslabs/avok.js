# Security

Avok wallets are self-custodial: no Avok server, and no operator hosting a Vault, holds a key or can
move a user's funds. That guarantee comes with tradeoffs. This page states them plainly. For the
contract-level security model (audited base, timelocked recovery, static-analysis boundary), see
[`contracts/SECURITY.md`](contracts/SECURITY.md).

## The four tradeoffs of the key model

Avok derives a wallet's root signing key from the user's passkey, inside the Vault, per gesture: it
is never stored and never leaves the page that derived it. That design has four consequences worth
stating outright.

**If the root key is ever reconstructed by someone else, the wallet must be abandoned.** This is not
the same as losing access to a key: it's someone else gaining it. Because the root key can issue a
new EIP-7702 delegation at any time, and that power cannot be revoked or gated by the wallet
contract, an attacker who reconstructs it holds the same authority the owner does. The only response
is to move funds to a new wallet. The Vault design (deriving the key only momentarily, inside a page
under the operator's control) exists specifically to keep this from happening.

**Losing the passkey freezes the ability to add or change signers, but doesn't freeze the wallet.**
The root key can't be recovered from anything but the passkey, so if it's gone, the wallet can never
delegate to a new contract version again. Any devices already registered as signers keep full use of
the wallet. This only matters if a critical bug is ever found in the contract the wallet delegated
to, since that contract can't be swapped out. It's covered here for completeness, not because it's a
day-to-day risk.

**The passkey's own sync provider is, in practice, part of the wallet's trust base.** Whatever
service syncs the user's passkey (Apple, Google, 1Password, Bitwarden) carries the material that can
reconstruct the root key. This is true of every passkey-based wallet, not unique to Avok, but it's
worth saying directly rather than leaving implicit: trusting a passkey means trusting how its
provider protects and syncs it.

**A wallet's very first transaction is the point it stops depending on the passkey alone.** Before
that first transaction, the wallet address exists but nothing has been delegated to a contract yet,
so there's no guardian set watching over it. Funds sent to that address before the first transaction
are protected only by the passkey itself. Avok's UI prompts a first transaction and guardian setup
early for this reason, and the receive screen states the window explicitly until delegation lands.

## Reporting a vulnerability

Please report suspected vulnerabilities privately rather than filing a public issue. Include enough
detail to reproduce the problem.
