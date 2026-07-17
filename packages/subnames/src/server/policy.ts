import type { Address } from "viem";
import { normalizeSubname } from "@avokjs/helpers";

export class LabelNotIssuableError extends Error {}

export interface LabelPolicyConfig {
  reserved?: string[];
  denylist?: string[];
  canIssueVoucher?: (a: { owner: Address; label: string }) => Promise<boolean> | boolean;
}

/**
 * ORIGIN-1: an operator label-policy gate on the voucher service. The PoP already proves the caller
 * controls `owner`; this adds the missing quota/reservation/denylist teeth so identity labels are
 * not squattable and operator-reserved names are protected. The label is ENS-normalized before every
 * comparison, so reservations can't be bypassed with confusables/casing.
 */
export function createLabelPolicy(cfg: LabelPolicyConfig) {
  const reserved = new Set((cfg.reserved ?? []).map((l) => normalizeSubname(l)));
  const denylist = new Set((cfg.denylist ?? []).map((l) => normalizeSubname(l)));

  return {
    async assertIssuable(a: { owner: Address; label: string }): Promise<void> {
      const label = normalizeSubname(a.label);
      if (reserved.has(label)) throw new LabelNotIssuableError(`label "${label}" is reserved`);
      if (denylist.has(label)) throw new LabelNotIssuableError(`label "${label}" is not allowed`);
      if (cfg.canIssueVoucher && !(await cfg.canIssueVoucher({ owner: a.owner, label }))) {
        throw new LabelNotIssuableError(`operator policy declined label "${label}"`);
      }
    },
  };
}
