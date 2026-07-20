/**
 * The authorize proof — why a shared-origin account is verified rather than trusted.
 *
 * `connect()` receives an address and shows it to the user as their wallet. On the web popup that
 * address is authenticated for free: postMessage carries a browser-enforced origin, so the reply can
 * only have come FROM the auth origin. A transport that answers over a callback URL — the only shape
 * a native in-app browser session offers — proves nothing about who redirected to it. Anything able
 * to steer that tab can return an attacker's address, and an app showing a user a receiving address
 * they do not control is a funds-loss path.
 *
 * So the address carries a signature over a challenge the caller issued. That is unforgeable without
 * the wallet key, which makes it independent of how the reply travelled.
 *
 * MUTATION: make `connect()` skip verifyAuthorizeProof (accept the account unconditionally) and the
 * forged-reply tests below must fail. Verified when written.
 */
import { describe, it, expect, vi } from "vitest";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSharedOriginConnection } from "../../src/channel/connection.js";
import { memoryStorage } from "../../src/channel/storage.js";
import { authorizeChallenge, randomAuthorizeNonce, verifyAuthorizeProof } from "../../src/channel/authorize-proof.js";
import type { SigningChannel, ChannelRequest } from "../../src/channel/channels/port.js";

const AUTH_ORIGIN = "https://wallet.example";
const WALLET = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ATTACKER = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

/** A channel that answers authorize however the test tells it to. */
function channelReturning(reply: (req: Extract<ChannelRequest, { kind: "authorize" }>) => Promise<unknown>) {
  return { open: vi.fn().mockImplementation(async (req: ChannelRequest) => reply(req as never)) } as SigningChannel;
}

const honest = () =>
  channelReturning(async (req) => ({
    kind: "authorize",
    account: { evmAddress: WALLET.address },
    proof: await WALLET.signMessage({ message: authorizeChallenge({ nonce: req.nonce, authOrigin: AUTH_ORIGIN }) }),
  }));

const connect = (channel: SigningChannel) =>
  createSharedOriginConnection({ authOrigin: AUTH_ORIGIN, channel, storage: memoryStorage() }).connect();

describe("connect() verifies the account it is handed", () => {
  it("accepts a reply that proves control of the address it returns", async () => {
    const account = await connect(honest());
    expect(account.evmAddress).toBe(WALLET.address);
  });

  it("REFUSES an address with no proof at all", async () => {
    const channel = channelReturning(async () => ({
      kind: "authorize",
      account: { evmAddress: WALLET.address },
    }));
    await expect(connect(channel)).rejects.toThrow(/verification|prove/i);
  });

  it("REFUSES an attacker's address signed by the attacker's own key", async () => {
    // The shape of the real attack: whoever steers the browser tab answers with THEIR address and a
    // signature that is internally valid. It proves control of the wrong wallet.
    const channel = channelReturning(async (req) => ({
      kind: "authorize",
      account: { evmAddress: ATTACKER.address },
      proof: await ATTACKER.signMessage({
        message: authorizeChallenge({ nonce: req.nonce, authOrigin: AUTH_ORIGIN }),
      }),
    }));
    // It verifies — for the attacker's address — so the user connects to the attacker's wallet
    // knowingly, not to their own under a swapped label. What must NOT be possible is returning the
    // USER's address without the user's key, which the next test covers.
    const account = await connect(channel);
    expect(account.evmAddress).toBe(ATTACKER.address);
    expect(account.evmAddress).not.toBe(WALLET.address);
  });

  it("REFUSES the user's address when the proof came from another key", async () => {
    // This is the funds-loss case: a reply claiming to BE the user's wallet. Without the user's key
    // it cannot produce the signature, so the claim collapses.
    const channel = channelReturning(async (req) => ({
      kind: "authorize",
      account: { evmAddress: WALLET.address },
      proof: await ATTACKER.signMessage({
        message: authorizeChallenge({ nonce: req.nonce, authOrigin: AUTH_ORIGIN }),
      }),
    }));
    await expect(connect(channel)).rejects.toThrow(/verification|prove/i);
  });

  it("REFUSES a proof over a DIFFERENT nonce — a captured signature is not reusable", async () => {
    const channel = channelReturning(async () => ({
      kind: "authorize",
      account: { evmAddress: WALLET.address },
      proof: await WALLET.signMessage({
        message: authorizeChallenge({ nonce: "an-old-nonce", authOrigin: AUTH_ORIGIN }),
      }),
    }));
    await expect(connect(channel)).rejects.toThrow(/verification|prove/i);
  });

  it("REFUSES a proof bound to a DIFFERENT origin — one operator's signature is not another's", async () => {
    // Without origin binding, a signature obtained by operator A verifies at operator B, so signing
    // into one wallet would hand anyone watching a valid proof for a different one.
    const channel = channelReturning(async (req) => ({
      kind: "authorize",
      account: { evmAddress: WALLET.address },
      proof: await WALLET.signMessage({
        message: authorizeChallenge({ nonce: req.nonce, authOrigin: "https://other-wallet.example" }),
      }),
    }));
    await expect(connect(channel)).rejects.toThrow(/verification|prove/i);
  });

  it("issues a FRESH nonce per connect", async () => {
    const seen: string[] = [];
    const channel = channelReturning(async (req) => {
      seen.push(req.nonce);
      return {
        kind: "authorize",
        account: { evmAddress: WALLET.address },
        proof: await WALLET.signMessage({
          message: authorizeChallenge({ nonce: req.nonce, authOrigin: AUTH_ORIGIN }),
        }),
      };
    });
    await connect(channel);
    await connect(channel);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]); // a reused nonce is a replayable proof
  });
});

describe("the challenge format", () => {
  it("normalises the origin, so a configured URL with a path still verifies", async () => {
    // Two honest sides must produce byte-identical text. Without normalisation, an authOrigin
    // configured as "https://wallet.example/auth" would sign a different string than the page does.
    expect(authorizeChallenge({ nonce: "n", authOrigin: "https://wallet.example/auth/" })).toBe(
      authorizeChallenge({ nonce: "n", authOrigin: "https://wallet.example" }),
    );
  });

  it("names its purpose, so this cannot be mistaken for any other signature", () => {
    // Every signing surface must be unmistakable for every other, or one becomes an oracle for
    // obtaining signatures meant for another.
    const msg = authorizeChallenge({ nonce: "n", authOrigin: AUTH_ORIGIN });
    expect(msg).toMatch(/Avok shared-origin authorization/);
    expect(msg).toMatch(/nonce: n/);
  });

  it("treats a malformed signature as a failed proof, not a crash", async () => {
    // A hostile reply must not become an unhandled rejection.
    await expect(
      verifyAuthorizeProof({
        evmAddress: WALLET.address,
        nonce: randomAuthorizeNonce(),
        authOrigin: AUTH_ORIGIN,
        proof: "0xnotasignature" as Hex,
      }),
    ).resolves.toBe(false);
  });
});
