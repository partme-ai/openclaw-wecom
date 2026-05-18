/**
 * 命令授权（Command Authorization）
 *
 * 从 @wecom/wecom-openclaw-plugin 迁移，适配 openclaw-wecom 的 WeComConfig 类型。
 */

import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";
import type { WeComAccountConfig } from "../types/config.js";

// ============================================================================
// 内部工具函数
// ============================================================================

function normalizeWecomAllowFromEntry(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^wecom:/, "")
    .replace(/^user:/, "")
    .replace(/^userid:/, "");
}

function isWecomSenderAllowed(senderUserId: string, allowFrom: string[]): boolean {
  const list = allowFrom.map((entry) => normalizeWecomAllowFromEntry(entry)).filter(Boolean);
  if (list.includes("*")) return true;
  const normalizedSender = normalizeWecomAllowFromEntry(senderUserId);
  if (!normalizedSender) return false;
  return list.includes(normalizedSender);
}

// ============================================================================
// 命令授权解析
// ============================================================================

export interface WecomCommandAuthResult {
  shouldComputeAuth: boolean;
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  senderAllowed: boolean;
  authorizerConfigured: boolean;
  commandAuthorized: boolean | undefined;
  effectiveAllowFrom: string[];
}

export async function resolveWecomCommandAuthorization(params: {
  core: PluginRuntime;
  cfg: OpenClawConfig;
  accountConfig: WeComAccountConfig;
  rawBody: string;
  senderUserId: string;
}): Promise<WecomCommandAuthResult> {
  const { core, cfg, accountConfig, rawBody, senderUserId } = params;

  const dmPolicy = (accountConfig.dmPolicy ?? "pairing") as "pairing" | "allowlist" | "open" | "disabled";
  const configAllowFrom = (accountConfig.allowFrom ?? []).map((v) => String(v));

  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(rawBody, cfg);

  const effectiveAllowFrom = dmPolicy === "open" ? ["*"] : configAllowFrom;

  const senderAllowed = isWecomSenderAllowed(senderUserId, effectiveAllowFrom);
  const allowAllConfigured = effectiveAllowFrom.some((entry) => normalizeWecomAllowFromEntry(entry) === "*");
  const authorizerConfigured = allowAllConfigured || effectiveAllowFrom.length > 0;
  const useAccessGroups = cfg.commands?.useAccessGroups !== false;

  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
      useAccessGroups,
      authorizers: [{ configured: authorizerConfigured, allowed: senderAllowed }],
    })
    : undefined;

  return {
    shouldComputeAuth,
    dmPolicy,
    senderAllowed,
    authorizerConfigured,
    commandAuthorized,
    effectiveAllowFrom,
  };
}

// ============================================================================
// 未授权提示文案构建
// ============================================================================

export function buildWecomUnauthorizedCommandPrompt(params: {
  senderUserId: string;
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  scope: "bot" | "agent";
}): string {
  const user = params.senderUserId || "unknown";
  const policy = params.dmPolicy;
  const scopeLabel = params.scope === "bot" ? "Bot（智能机器人）" : "Agent（自建应用）";
  const dmPrefix = params.scope === "bot" ? "channels.wecom.bot" : "channels.wecom.agent";
  const allowCmd = (value: string): string => `openclaw config set ${dmPrefix}.allowFrom '${value}'`;
  const policyCmd = (value: string): string => `openclaw config set ${dmPrefix}.dmPolicy "${value}"`;

  if (policy === "disabled") {
    return [
      `无权限执行命令（${scopeLabel} 已禁用：dmPolicy=disabled）`,
      `触发者：${user}`,
      `管理员：${policyCmd("open")}（全放开）或 ${policyCmd("allowlist")}（白名单）`,
    ].join("\n");
  }

  return [
    `无权限执行命令（入口：${scopeLabel}，userid：${user}）`,
    `管理员全放开：${policyCmd("open")}`,
    `管理员放行该用户：${policyCmd("allowlist")}`,
    `然后设置白名单：${allowCmd(JSON.stringify([user]))}`,
    `如果仍被拦截：检查 commands.useAccessGroups/访问组`,
  ].join("\n");
}
