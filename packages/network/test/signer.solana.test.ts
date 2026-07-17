import { describe, it, expect, vi } from "vitest";
import { base64, base58 } from "@scure/base";
import { createRemoteSigner } from "../src/signer.js";
import type { ChannelResult } from "../src/channels/port.js";

describe("remote Signer — Solana verbs", () => {
  it("signSolanaTransaction sends base64 message bytes and returns the base58 signature + consent", async () => {
    const msg = new Uint8Array([9, 8, 7]);
    const fakeSig = base58.encode(new Uint8Array(64).fill(7));
    const open = vi.fn(async (req: any): Promise<ChannelResult> => {
      expect(req.kind).toBe("sign");
      expect(req.request.op).toBe("signSolanaTransaction");
      expect(req.request.messageBytesB64).toBe(base64.encode(msg));
      return { kind: "sign", result: { signature: fakeSig, consent: { feePayer: "x", instructions: [] } } };
    });
    const signer = createRemoteSigner({ channel: { open }, credentialId: "s1" });
    const res = await signer.signSolanaTransaction(msg);
    expect(res.signature).toBe(fakeSig);
    expect(res.consent).toMatchObject({ feePayer: "x" });
  });

  it("signSolanaTransaction forwards the optional cluster hint on the wire", async () => {
    const msg = new Uint8Array([1, 2, 3]);
    const fakeSig = base58.encode(new Uint8Array(64).fill(3));
    const open = vi.fn(async (req: any): Promise<ChannelResult> => {
      expect(req.request.op).toBe("signSolanaTransaction");
      expect(req.request.messageBytesB64).toBe(base64.encode(msg));
      expect(req.request.cluster).toBe("devnet");
      return { kind: "sign", result: { signature: fakeSig, consent: { feePayer: "x", instructions: [] } } };
    });
    const signer = createRemoteSigner({ channel: { open }, credentialId: "s1" });
    const res = await signer.signSolanaTransaction(msg, { cluster: "devnet" });
    expect(res.signature).toBe(fakeSig);
  });

  it("omits cluster from the wire when no hint is given (backward-safe)", async () => {
    const msg = new Uint8Array([4, 5, 6]);
    const open = vi.fn(async (): Promise<ChannelResult> => ({ kind: "sign", result: { signature: "Sig11", consent: {} } }));
    const signer = createRemoteSigner({ channel: { open }, credentialId: "s1" });
    await signer.signSolanaTransaction(msg);
    expect(open).toHaveBeenCalledWith({
      kind: "sign",
      credentialId: "s1",
      request: { op: "signSolanaTransaction", messageBytesB64: base64.encode(msg) },
    });
  });

  it("signSolanaMessage forwards the message and returns the signature", async () => {
    const open = vi.fn(async (): Promise<ChannelResult> => ({ kind: "sign", result: { signature: "Sig11" } }));
    const signer = createRemoteSigner({ channel: { open }, credentialId: "s1" });
    expect(await signer.signSolanaMessage("hello")).toEqual({ signature: "Sig11" });
    expect(open).toHaveBeenCalledWith({ kind: "sign", credentialId: "s1", request: { op: "signSolanaMessage", message: "hello" } });
  });
});
