/**
 * Webhook Gateway 生命周期管理
 *
 * 从 @wecom/wecom-openclaw-plugin 迁移，适配 openclaw-wecom。
 * 负责：初始化状态、注册 Target、启停管理。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { WebhookGatewayContext, WecomWebhookTarget, PendingInbound } from "./types.js";
import { PRUNE_INTERVAL_MS, WEBHOOK_PATHS } from "./types.js";
import { monitorState, WebhookMonitorState } from "./state.js";
import { registerWecomWebhookTarget, hasActiveTargets } from "./target.js";
import { startAgentForStream } from "./monitor.js";
import { detectMode } from "../config/accounts.js";
import { DEFAULT_ACCOUNT_ID } from "../compat/plugin-sdk-shim.js";
import { getWeComRuntime } from "../runtime.js";

// ============================================================================
// 全局状态
// ============================================================================

const accountUnregisters = new Map<string, () => void>();

let flushHandlerInstalled = false;

// ============================================================================
// 路径解析
// ============================================================================

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((p) => p.trim()).filter(Boolean)));
}

function resolveBotRegistrationPaths(params: {
  accountId: string;
  matrixMode: boolean;
}): string[] {
  if (params.matrixMode) {
    return uniquePaths([
      `${WEBHOOK_PATHS.BOT_PLUGIN}/${params.accountId}`,
      `${WEBHOOK_PATHS.BOT_ALT}/${params.accountId}`,
      WEBHOOK_PATHS.BOT_PLUGIN,
      WEBHOOK_PATHS.BOT,
      WEBHOOK_PATHS.BOT_ALT,
    ]);
  }
  return uniquePaths([
    WEBHOOK_PATHS.BOT_PLUGIN,
    WEBHOOK_PATHS.BOT,
    WEBHOOK_PATHS.BOT_ALT,
    `${WEBHOOK_PATHS.BOT_PLUGIN}/${DEFAULT_ACCOUNT_ID}`,
    `${WEBHOOK_PATHS.BOT_ALT}/${DEFAULT_ACCOUNT_ID}`,
  ]);
}

// ============================================================================
// 公共 API
// ============================================================================

export function getMonitorState(): WebhookMonitorState {
  return monitorState;
}

export function startWebhookGateway(ctx: WebhookGatewayContext): void {
  const { account, config, runtime } = ctx;
  const log = ctx.log ?? {
    info: (msg: string) => runtime.log(msg),
    error: (msg: string) => runtime.error(msg),
  };

  // 1. 验证必要配置
  if (!account.token || !account.encodingAESKey) {
    const missing: string[] = [];
    if (!account.token) missing.push("token");
    if (!account.encodingAESKey) missing.push("encodingAESKey");

    const errorMsg = `[webhook] Webhook 配置不完整，缺少: ${missing.join(", ")}`;
    log.error(errorMsg);

    ctx.setStatus?.({
      accountId: ctx.accountId,
      running: false,
      configured: false,
      lastError: errorMsg,
    });
    return;
  }

  log.info(`[webhook] 启动 Webhook Gateway (accountId=${ctx.accountId})`);

  // 2. 确保 pruneTimer 启动
  monitorState.startPruning(PRUNE_INTERVAL_MS);

  // 3. 设置 FlushHandler（仅首次）
  if (!flushHandlerInstalled) {
    monitorState.streamStore.setFlushHandler((pending) => void flushPending(pending));
    flushHandlerInstalled = true;
  }

  // 4. 构造 Target 上下文
  const runtimeEnv = {
    log: (msg: string) => runtime.log(msg),
    error: (msg: string) => runtime.error(msg),
  };

  const matrixMode = detectMode(ctx.config.channels?.wecom as any) === "matrix";

  const target: WecomWebhookTarget = {
    account,
    config,
    runtime: runtimeEnv,
    core: (ctx.channelRuntime ?? runtime) as any,
    path: `${WEBHOOK_PATHS.BOT_PLUGIN}/${ctx.accountId}`,
    statusSink: ctx.setStatus
      ? (patch) => ctx.setStatus?.({ accountId: ctx.accountId, ...patch })
      : undefined,
  };

  // 5. 解析注册路径
  const paths = resolveBotRegistrationPaths({
    accountId: ctx.accountId,
    matrixMode,
  });

  // 6. 注册 Target
  const existingUnregister = accountUnregisters.get(ctx.accountId);
  if (existingUnregister) {
    existingUnregister();
  }

  const unregister = registerWecomWebhookTarget(target, paths);
  accountUnregisters.set(ctx.accountId, unregister);

  log.info(
    `[webhook] Webhook Target 已注册 (accountId=${ctx.accountId}, paths=[${paths.join(", ")}])`,
  );

  // 7. 更新状态
  ctx.setStatus?.({
    accountId: ctx.accountId,
    running: true,
    configured: true,
    webhookPath: paths[0],
    lastStartAt: Date.now(),
  });
}

export function stopWebhookGateway(ctx: WebhookGatewayContext): void {
  const log = ctx.log ?? {
    info: (msg: string) => ctx.runtime.log(msg),
    error: (msg: string) => ctx.runtime.error(msg),
  };

  log.info(`[webhook] 停止 Webhook Gateway (accountId=${ctx.accountId})`);

  const unregister = accountUnregisters.get(ctx.accountId);
  if (unregister) {
    unregister();
    accountUnregisters.delete(ctx.accountId);
  }

  if (!hasActiveTargets()) {
    monitorState.stopPruning();
  }

  ctx.setStatus?.({
    accountId: ctx.accountId,
    running: false,
    lastStopAt: Date.now(),
  });
}

// ============================================================================
// flushPending 中间层
// ============================================================================

async function flushPending(pending: PendingInbound): Promise<void> {
  const { streamId, target, msg, contents, msgids, conversationKey, batchKey } = pending;
  const { streamStore } = monitorState;

  const mergedContents = contents.filter(c => c.trim()).join("\n").trim();

  let core: PluginRuntime | null = null;
  try {
    core = getWeComRuntime();
  } catch (err) {
    target.runtime.log?.(
      `[webhook] flush pending: runtime not ready: ${String(err)}`,
    );
    streamStore.markFinished(streamId);
    target.runtime.log?.(
      `[webhook] queue: runtime not ready，结束批次并推进 streamId=${streamId}`,
    );
    streamStore.onStreamFinished(streamId);
    return;
  }

  if (core) {
    streamStore.markStarted(streamId);
    const enrichedTarget: WecomWebhookTarget = { ...target, core };
    target.runtime.log?.(
      `[webhook] flush pending: start batch streamId=${streamId} batchKey=${batchKey} conversationKey=${conversationKey} mergedCount=${contents.length}`,
    );

    startAgentForStream({
      target: enrichedTarget,
      accountId: target.account.accountId,
      msg,
      streamId,
      mergedContents: contents.length > 1 ? mergedContents : undefined,
      mergedMsgids: msgids.length > 1 ? msgids : undefined,
    }).catch((err) => {
      streamStore.updateStream(streamId, (state) => {
        state.error = err instanceof Error ? err.message : String(err);
        state.content = state.content || `Error: ${state.error}`;
        state.finished = true;
      });
      target.runtime.error?.(
        `[webhook] Agent 处理失败 (streamId=${streamId}): ${String(err)}`,
      );
      streamStore.onStreamFinished(streamId);
    });
  }
}
