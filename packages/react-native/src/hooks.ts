/**
 * Avok React Native hooks — identical surface to @avokjs/react hooks,
 * re-implemented here to avoid pulling the web-React/DOM graph.
 *
 * Thin state wrappers only; no key handling here. Sending and signing are NOT hooks — on native they
 * go through the wallet's provider surfaces, not a bespoke hook (VISION §6). `useDevices`/
 * `useGuardians` follow the same rule: `register`/`revoke`/`setupGuardians`/`proposeGuardianOp`/
 * `executeGuardianOp`/`vetoGuardianOp` are all `onlyThis`/`onlySelf` on the wallet contract, satisfied
 * by an ORDINARY self-call batch — no new signing primitive, no vault protocol kind. These hooks
 * build the `Call` and read the current roster/guardian state; SENDING the call is the app's own
 * transaction submission through the announced provider, exactly like any other action.
 *
 * There is no more own-origin custody posture to gate a "self-custody" hook family behind (D3:
 * popup-for-all).
 *
 * Recovery is deliberately absent here: a guardian's APPROVAL of a recovery is a different actor's
 * action (the guardian's own key, not the wallet's), and TDD §7 puts that UX on the origin-point page
 * itself, not the app. There is no `useRecovery` because there is no app-side entry point to wrap.
 */
import { useCallback, useState } from "react";
import type { AvokClient, Account, ContinueOpts } from "@avokjs/core/engine";
import type { Call, RpcClient, RosterEntry, GuardianOp } from "@avokjs/core/evm";
import {
  buildRegisterDeviceCall,
  buildRevokeDeviceCall,
  readDeviceRoster,
  buildSetupGuardiansCall,
  buildProposeGuardianOpCall,
  buildExecuteGuardianOpCall,
  buildVetoGuardianOpCall,
  readGuardianState,
} from "@avokjs/core/evm";
import { useAvokContext } from "./provider.js";

// Avoids a direct `viem` dependency in this file for two bare hex-string parameter types (this
// package DOES declare viem already, for Metro's transitive-resolution rule — see
// runtime-deps.test.ts — but nothing else in this file needs its full type surface).
type Address = `0x${string}`;
type Hex = `0x${string}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a pending/error wrapper around an async op that delegates to the client. */
function useMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  deps: unknown[],
): { call: (...args: TArgs) => Promise<TResult>; pending: boolean; error: Error | null } {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const call = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setPending(false);
      }
    },
    // fn itself is stable (created with useCallback in callers) so spreading deps is correct
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  return { call, pending, error };
}

// ─── Public hooks ─────────────────────────────────────────────────────────────

/** Returns the AvokClient from context. */
export function useAvok(): AvokClient {
  return useAvokContext().client;
}

/** Reactive account + session status. Updates after every ceremony/logout. */
export function useAccount(): { account: Account | null; status: boolean } {
  const { account, status } = useAvokContext();
  return { account, status };
}

/** Log in to (recover / resume) an existing account. */
export function useLogin(): {
  login: (o?: ContinueOpts) => Promise<Account>;
  pending: boolean;
  error: Error | null;
} {
  const { client } = useAvokContext();
  const { call, pending, error } = useMutation((o?: ContinueOpts) => client.login(o), [client]);
  return { login: call, pending, error };
}

/** Logout and clear session. */
export function useLogout(): {
  logout: () => Promise<void>;
  pending: boolean;
  error: Error | null;
} {
  const { client } = useAvokContext();
  const { call, pending, error } = useMutation(async () => {
    await (client.logout() as Promise<void> | void);
  }, [client]);
  return { logout: call, pending, error };
}

/** Read `error` for "no active account" before calling anything that assumes one. */
function requireWalletAddress(account: Account | null): Address {
  const address = account?.evm.address;
  if (!address) throw new Error("No account is active — log in first");
  return address as Address;
}

/**
 * The device roster: who can sign for this wallet. `devices` is `null` until the first `refresh()`.
 * `buildRegisterCall`/`buildRevokeCall` produce a `{to, value, data}` the app sends through its own
 * transaction submission — this hook never signs or submits anything itself.
 */
export function useDevices(rpc: RpcClient): {
  devices: RosterEntry[] | null;
  refresh: () => Promise<void>;
  buildRegisterCall: (deviceAddress: Address) => Call;
  buildRevokeCall: (keyHash: Hex) => Call;
  pending: boolean;
  error: Error | null;
} {
  const { account } = useAvokContext();
  const [devices, setDevices] = useState<RosterEntry[] | null>(null);

  const doRefresh = useCallback(async () => {
    const wallet = requireWalletAddress(account);
    setDevices(await readDeviceRoster(rpc, wallet));
  }, [account, rpc]);

  const { call: refresh, pending, error } = useMutation(doRefresh, [doRefresh]);

  return {
    devices,
    refresh,
    buildRegisterCall: (deviceAddress: Address) =>
      buildRegisterDeviceCall(requireWalletAddress(account), deviceAddress),
    buildRevokeCall: (keyHash: Hex) => buildRevokeDeviceCall(requireWalletAddress(account), keyHash),
    pending,
    error,
  };
}

/**
 * Guardian-SET management: who the guardians are, and building the setup/propose/execute/veto calls
 * that change them. `guardians`/`pendingOp` are `null` until the first `refresh()`. This is the
 * wallet OWNER managing their own guardians — a guardian's own approval of a recovery is a different
 * action entirely, on the vault's own recovery page (see this file's module header).
 */
export function useGuardians(rpc: RpcClient): {
  guardians: { addresses: Address[]; threshold: number } | null;
  pendingOp: { promoteKey: Address; readyAt: number } | null;
  refresh: () => Promise<void>;
  buildSetupCall: (args: {
    guardians: Address[];
    threshold: number;
    recoveryDelaySeconds: number;
    guardianOpDelaySeconds: number;
  }) => Call;
  buildProposeCall: (op: GuardianOp) => Call;
  buildExecuteCall: (op: GuardianOp) => Call;
  buildVetoCall: (opHash: Hex) => Call;
  pending: boolean;
  error: Error | null;
} {
  const { account } = useAvokContext();
  const [guardians, setGuardians] = useState<{ addresses: Address[]; threshold: number } | null>(null);
  const [pendingOp, setPendingOp] = useState<{ promoteKey: Address; readyAt: number } | null>(null);

  const doRefresh = useCallback(async () => {
    const wallet = requireWalletAddress(account);
    const { config, pending } = await readGuardianState(rpc, wallet);
    setGuardians({ addresses: config.guardians, threshold: config.threshold });
    setPendingOp(pending ? { promoteKey: pending.promoteKey, readyAt: pending.readyAt } : null);
  }, [account, rpc]);

  const { call: refresh, pending, error } = useMutation(doRefresh, [doRefresh]);

  return {
    guardians,
    pendingOp,
    refresh,
    buildSetupCall: (args) => buildSetupGuardiansCall({ wallet: requireWalletAddress(account), ...args }),
    buildProposeCall: (op) => buildProposeGuardianOpCall(requireWalletAddress(account), op),
    buildExecuteCall: (op) => buildExecuteGuardianOpCall(requireWalletAddress(account), op),
    buildVetoCall: (opHash) => buildVetoGuardianOpCall(requireWalletAddress(account), opHash),
    pending,
    error,
  };
}
