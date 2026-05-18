/**
 * Webhook Target 管理
 *
 * 从 @wecom/wecom-openclaw-plugin 迁移。
 * 维护全局已注册 Target 列表，提供注册/注销/查询功能。
 */

import type { WecomWebhookTarget } from "./types.js";

// ============================================================================
// 全局 Target 注册表（按路径索引）
// ============================================================================

/** 已注册的 Webhook Target（按路径索引） */
const webhookTargets = new Map<string, WecomWebhookTarget[]>();

// ============================================================================
// 路径工具函数
// ============================================================================

function normalizeWebhookPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) return withSlash.slice(0, -1);
  return withSlash;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((p) => normalizeWebhookPath(p)).filter(Boolean)));
}

// ============================================================================
// 注册 / 注销
// ============================================================================

function registerTargetForPath(path: string, target: WecomWebhookTarget): () => void {
  const key = normalizeWebhookPath(path);
  const normalizedTarget = { ...target, path: key };
  const existing = webhookTargets.get(key) ?? [];
  webhookTargets.set(key, [...existing, normalizedTarget]);

  return () => {
    const updated = (webhookTargets.get(key) ?? []).filter((entry) => entry !== normalizedTarget);
    if (updated.length > 0) webhookTargets.set(key, updated);
    else webhookTargets.delete(key);
  };
}

export function registerWecomWebhookTarget(
  target: WecomWebhookTarget,
  paths: string[],
): () => void {
  const unregisters: Array<() => void> = [];

  for (const path of uniquePaths(paths)) {
    unregisters.push(registerTargetForPath(path, target));
  }

  return () => {
    for (const unregister of unregisters) {
      unregister();
    }
  };
}

export function getWebhookTargetsMap(): ReadonlyMap<string, WecomWebhookTarget[]> {
  return webhookTargets;
}

export function getRegisteredTargets(): WecomWebhookTarget[] {
  const seen = new Set<WecomWebhookTarget>();
  const result: WecomWebhookTarget[] = [];
  for (const list of webhookTargets.values()) {
    for (const target of list) {
      if (!seen.has(target)) {
        seen.add(target);
        result.push(target);
      }
    }
  }
  return result;
}

export function hasActiveTargets(): boolean {
  return webhookTargets.size > 0;
}

export function parseWebhookPath(url: string): string | undefined {
  const patterns = [
    /\/plugins\/wecom\/bot\/([^/?]+)/,
    /\/wecom\/bot\/([^/?]+)/,
    /\/wecom\/([^/?]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      const segment = match[1];
      if (segment === "bot") continue;
      return segment;
    }
  }
  return undefined;
}
