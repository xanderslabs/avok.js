import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { createRecoverCeremony } from "../../../src/auth-popup/recover/ceremony.js";
import type { RecoveryFlow } from "../../../src/vault/recover/flow.js";
import type { GuardianConfig, PendingRecovery } from "../../../src/vault/recover/read.js";
import type { GuardianApproval } from "../../../src/vault/recover/approve.js";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const GUARDIAN_A = "0x2222222222222222222222222222222222222222" as Address;
const OUTSIDER = "0x9999999999999999999999999999999999999999" as Address;
const PROMOTE_KEY = "0x4444444444444444444444444444444444444444" as Address;
const CONFIG_ONE_GUARDIAN: GuardianConfig = {
  guardians: [GUARDIAN_A],
  threshold: 1,
  recoveryDelaySeconds: 86400,
  guardianOpDelaySeconds: 43200,
};
const NO_GUARDIANS: GuardianConfig = { ...CONFIG_ONE_GUARDIAN, guardians: [] };
const PENDING: PendingRecovery = { promoteKey: PROMOTE_KEY, nonce: 7n, approvals: 1, readyAt: 12345 };

function fakeFlow(overrides: Partial<RecoveryFlow> = {}): RecoveryFlow {
  return {
    enterWallet: vi.fn(async () => ({ wallet: WALLET })),
    readGuardianState: vi.fn(async () => ({ config: CONFIG_ONE_GUARDIAN, pending: null })),
    approveAsConnectedGuardian: vi.fn(async () => ({
      guardian: GUARDIAN_A,
      promoteKey: PROMOTE_KEY,
      nonce: 0n,
      signature: "0xsig" as Hex,
    })),
    approveWithImportedKey: vi.fn(async () => ({
      guardian: GUARDIAN_A,
      promoteKey: PROMOTE_KEY,
      nonce: 0n,
      signature: "0xsig2" as Hex,
    })),
    vetoView: vi.fn(async () => ({ pending: null, canVeto: false })),
    ...overrides,
  };
}

function baseDeps(overrides: Partial<Parameters<typeof createRecoverCeremony>[0]> = {}) {
  return {
    flow: fakeFlow(),
    chainId: 10,
    mintPromoteKey: vi.fn(async () => ({ address: PROMOTE_KEY })),
    connectGuardianWallet: vi.fn(async () => ({
      address: GUARDIAN_A,
      signTypedData: vi.fn(async () => "0xconnsig" as Hex),
    })),
    ...overrides,
  };
}

describe("createRecoverCeremony", () => {
  it("starts on the enter step", () => {
    const c = createRecoverCeremony(baseDeps());
    expect(c.getState()).toEqual({ step: "enter" });
  });

  it("enterWallet resolves the wallet and reads guardian state, landing on guardian-state", async () => {
    const flow = fakeFlow({
      readGuardianState: vi.fn(async () => ({ config: CONFIG_ONE_GUARDIAN, pending: PENDING })),
    });
    const c = createRecoverCeremony(baseDeps({ flow }));
    await c.enterWallet(WALLET);
    expect(c.getState()).toEqual({
      step: "guardian-state",
      wallet: WALLET,
      config: CONFIG_ONE_GUARDIAN,
      pending: PENDING,
    });
  });

  it("enterWallet: an unresolvable name lands on the error step with the flow's own message", async () => {
    const flow = fakeFlow({
      enterWallet: vi.fn(async () => {
        throw new Error('Could not resolve "nobody.eth" to a wallet address');
      }),
    });
    const c = createRecoverCeremony(baseDeps({ flow }));
    await c.enterWallet("nobody.eth");
    expect(c.getState()).toEqual({ step: "error", message: 'Could not resolve "nobody.eth" to a wallet address' });
  });

  it("beginApproval before enterWallet throws — there is no wallet to approve a recovery for", async () => {
    const c = createRecoverCeremony(baseDeps());
    await expect(c.beginApproval()).rejects.toThrow(/enterWallet/);
  });

  it("beginApproval mints this device's fresh promote key and moves to approving", async () => {
    const mintPromoteKey = vi.fn(async () => ({ address: PROMOTE_KEY }));
    const c = createRecoverCeremony(baseDeps({ mintPromoteKey }));
    await c.enterWallet(WALLET);
    await c.beginApproval();
    expect(mintPromoteKey).toHaveBeenCalledOnce();
    expect(c.getState()).toEqual({
      step: "approving",
      wallet: WALLET,
      config: CONFIG_ONE_GUARDIAN,
      pending: null,
      promoteKey: PROMOTE_KEY,
    });
  });

  it("beginApproval refuses a wallet with no guardians configured, without minting a key", async () => {
    const flow = fakeFlow({ readGuardianState: vi.fn(async () => ({ config: NO_GUARDIANS, pending: null })) });
    const mintPromoteKey = vi.fn(async () => ({ address: PROMOTE_KEY }));
    const c = createRecoverCeremony(baseDeps({ flow, mintPromoteKey }));
    await c.enterWallet(WALLET);
    await c.beginApproval();
    expect(mintPromoteKey).not.toHaveBeenCalled();
    expect(c.getState()).toEqual({
      step: "error",
      message: "This wallet has no guardians configured — recovery is not available.",
    });
  });

  it("approveWithConnectedGuardian: connects, signs, and lands on submitted with the approval", async () => {
    const approval: GuardianApproval = {
      guardian: GUARDIAN_A,
      promoteKey: PROMOTE_KEY,
      nonce: 0n,
      signature: "0xsig" as Hex,
    };
    const flow = fakeFlow({ approveAsConnectedGuardian: vi.fn(async () => approval) });
    const c = createRecoverCeremony(baseDeps({ flow }));
    await c.enterWallet(WALLET);
    await c.beginApproval();
    await c.approveWithConnectedGuardian();
    expect(flow.approveAsConnectedGuardian).toHaveBeenCalledWith(
      expect.objectContaining({
        guardian: GUARDIAN_A,
        wallet: WALLET,
        chainId: 10,
        promoteKey: PROMOTE_KEY,
        nonce: 0n,
      }),
    );
    expect(c.getState()).toEqual({ step: "submitted", approval });
  });

  it("approveWithConnectedGuardian uses the pending recovery's own nonce when one is already in flight", async () => {
    const flow = fakeFlow({
      readGuardianState: vi.fn(async () => ({ config: CONFIG_ONE_GUARDIAN, pending: PENDING })),
    });
    const c = createRecoverCeremony(baseDeps({ flow }));
    await c.enterWallet(WALLET);
    await c.beginApproval();
    await c.approveWithConnectedGuardian();
    expect(flow.approveAsConnectedGuardian).toHaveBeenCalledWith(expect.objectContaining({ nonce: PENDING.nonce }));
  });

  it("approveWithConnectedGuardian rejects a connected address that is not on the guardian roster", async () => {
    const connectGuardianWallet = vi.fn(async () => ({ address: OUTSIDER, signTypedData: vi.fn() }));
    const flow = fakeFlow();
    const c = createRecoverCeremony(baseDeps({ flow, connectGuardianWallet }));
    await c.enterWallet(WALLET);
    await c.beginApproval();
    await c.approveWithConnectedGuardian();
    expect(flow.approveAsConnectedGuardian).not.toHaveBeenCalled();
    // Stays on "approving" (not a terminal error step) — the promote key already minted is still
    // good, and the user can retry with a DIFFERENT connected wallet without a second passkey ceremony.
    expect(c.getState()).toMatchObject({ step: "approving", promoteKey: PROMOTE_KEY });
    expect((c.getState() as { error?: string }).error).toMatch(/not.*guardian/i);
  });

  it("approveWithConnectedGuardian: a rejected signature stays on approving so the user can retry", async () => {
    const connectGuardianWallet = vi.fn(async () => ({
      address: GUARDIAN_A,
      signTypedData: vi.fn(async () => {
        throw new Error("User rejected the request");
      }),
    }));
    // The real `approveAsConnectedGuardian` calls `args.signTypedData(typedData)` itself — the fake
    // must do the same, or this test would never actually exercise the rejection it claims to.
    const flow = fakeFlow({
      approveAsConnectedGuardian: vi.fn(async (args) => {
        await args.signTypedData({} as never);
        throw new Error("unreachable: signTypedData above always throws in this test");
      }),
    });
    const c = createRecoverCeremony(baseDeps({ flow, connectGuardianWallet }));
    await c.enterWallet(WALLET);
    await c.beginApproval();
    await c.approveWithConnectedGuardian();
    expect(c.getState()).toEqual({
      step: "approving",
      wallet: WALLET,
      config: CONFIG_ONE_GUARDIAN,
      pending: null,
      promoteKey: PROMOTE_KEY,
      error: "User rejected the request",
    });
  });

  it("approveWithImportedKey: materializes, signs, and lands on submitted with the approval", async () => {
    const approval: GuardianApproval = {
      guardian: GUARDIAN_A,
      promoteKey: PROMOTE_KEY,
      nonce: 0n,
      signature: "0xsig2" as Hex,
    };
    const flow = fakeFlow({ approveWithImportedKey: vi.fn(async () => approval) });
    const c = createRecoverCeremony(baseDeps({ flow }));
    await c.enterWallet(WALLET);
    await c.beginApproval();
    await c.approveWithImportedKey("0xdeadbeef" as Hex);
    expect(flow.approveWithImportedKey).toHaveBeenCalledWith(
      expect.objectContaining({
        privateKey: "0xdeadbeef",
        wallet: WALLET,
        chainId: 10,
        promoteKey: PROMOTE_KEY,
        nonce: 0n,
      }),
    );
    expect(c.getState()).toEqual({ step: "submitted", approval });
  });

  it("approveWithImportedKey before beginApproval throws — there is no promote key to approve yet", async () => {
    const c = createRecoverCeremony(baseDeps());
    await c.enterWallet(WALLET);
    await expect(c.approveWithImportedKey("0xdeadbeef" as Hex)).rejects.toThrow(/beginApproval/);
  });
});
