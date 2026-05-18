import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { ResolvedWeComAccount } from "./types/index.js";
import {
  listWeComAccountIds as listWeComAccountIdsFromConfig,
  resolveDefaultWeComAccountId as resolveDefaultWeComAccountIdFromConfig,
  resolveWeComAccount as resolveWeComAccountFromConfig,
} from "./config/accounts.js";

/**
 * Backward-compatible re-export layer.
 * Keep this file as a thin wrapper so older imports continue to work,
 * while all account logic stays single-sourced in `src/config/accounts.ts`.
 */
export function listWeComAccountIds(cfg: OpenClawConfig): string[] {
  return listWeComAccountIdsFromConfig(cfg);
}

export function resolveDefaultWeComAccountId(cfg: OpenClawConfig): string {
  return resolveDefaultWeComAccountIdFromConfig(cfg);
}

export function resolveWeComAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedWeComAccount {
  return resolveWeComAccountFromConfig(params);
}

export function listEnabledWeComAccounts(cfg: OpenClawConfig): ResolvedWeComAccount[] {
  return listWeComAccountIdsFromConfig(cfg)
    .map((accountId) => resolveWeComAccountFromConfig({ cfg, accountId }))
    .filter((account) => account.enabled);
}
