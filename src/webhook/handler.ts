/**
 * Webhook HTTP 请求处理
 *
 * 从 @wecom/wecom-openclaw-plugin 迁移，适配 openclaw-wecom。
 * 负责：GET/POST 请求分流、签名验证、消息解密、按消息类型分发。
 */

import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getRegisteredTargets, getWebhookTargetsMap, parseWebhookPath } from "./target.js";
import type { WecomWebhookTarget, WebhookInboundMessage } from "./types.js";
import { resolveWeComEgressProxyUrl } from "../config/network.js";
import {
  handleInboundMessage,
  handleStreamRefresh,
  handleEnterChat,
  handleTemplateCardEvent,
} from "./monitor.js";
import { hasActiveTargets } from "./target.js";
import {
  resolveWecomSenderUserId,
} from "./helpers.js";
import { WecomCrypto } from "@wecom/aibot-node-sdk";

// ============================================================================
// 辅助函数
// ============================================================================

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx < 0) return {};
  const params = new URLSearchParams(url.slice(idx + 1));
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

function resolveSignatureParam(query: Record<string, string>): string {
  return query.msg_signature ?? query.msgsignature ?? query.signature ?? "";
}


function shouldProcessBotInboundMessage(
  msg: WebhookInboundMessage,
): { shouldProcess: boolean; reason: string; senderUserId?: string; chatId?: string } {
  const senderUserId = resolveWecomSenderUserId(msg)?.trim();

  if (!senderUserId) {
    return { shouldProcess: false, reason: "missing_sender" };
  }
  if (senderUserId.toLowerCase() === "sys") {
    return { shouldProcess: false, reason: "system_sender" };
  }

  const chatType = String(msg.chattype ?? "").trim().toLowerCase();
  if (chatType === "group") {
    const chatId = msg.chatid?.trim();
    if (!chatId) {
      return { shouldProcess: false, reason: "missing_chatid", senderUserId };
    }
    return { shouldProcess: true, reason: "user_message", senderUserId, chatId };
  }

  return { shouldProcess: true, reason: "user_message", senderUserId, chatId: senderUserId };
}

function resolveBotIdentitySet(target: WecomWebhookTarget): Set<string> {
  const ids = new Set<string>();
  const botId = target.account.botConfig?.botId?.trim();
  if (botId) ids.add(botId);
  const configBotId = target.account.botConfig?.botId?.trim();
  if (configBotId) ids.add(configBotId);
  return ids;
}

const MAX_BODY_BYTES = 1024 * 1024;

function readBody(
  req: IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        resolve({ ok: false, error: "payload too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({ ok: false, error: "empty payload" });
        return;
      }
      resolve({ ok: true, value: raw });
    });
    req.on("error", (err) => {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  });
}

function encryptResponse(
  target: WecomWebhookTarget,
  responseData: Record<string, unknown>,
  timestamp: string,
  nonce: string,
): { encrypt: string; msgsignature: string; timestamp: string; nonce: string } {
  const plaintext = JSON.stringify(responseData);
  const wc = new WecomCrypto(target.account.token, target.account.encodingAESKey, target.account.receiveId);
  const { encrypt, signature } = wc.encrypt(plaintext, timestamp, nonce);

  return { encrypt, msgsignature: signature, timestamp, nonce };
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendEncryptedReply(res: ServerResponse, data: unknown): void {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res: ServerResponse, statusCode: number, text: string): void {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

// ============================================================================
// 路径解析
// ============================================================================

function normalizeRequestPath(url: string): string {
  const idx = url.indexOf("?");
  const pathname = idx >= 0 ? url.slice(0, idx) : url;
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === "/") return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) return withSlash.slice(0, -1);
  return withSlash;
}

function deduplicateByAccountId(targets: WecomWebhookTarget[]): WecomWebhookTarget[] {
  const seen = new Set<string>();
  const result: WecomWebhookTarget[] = [];
  for (const target of targets) {
    if (!seen.has(target.account.accountId)) {
      seen.add(target.account.accountId);
      result.push(target);
    }
  }
  return result;
}

// ============================================================================
// 多账号签名匹配
// ============================================================================

type MatchResult =
  | { status: "matched"; target: WecomWebhookTarget }
  | { status: "not_found"; candidateAccountIds: string[] }
  | { status: "conflict"; candidateAccountIds: string[] };

function findMatchingTarget(
  requestPath: string,
  signature: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  pathAccountId?: string,
): MatchResult {
  const targetsMap = getWebhookTargetsMap();
  const normalizedPath = normalizeRequestPath(requestPath);
  const pathTargets = targetsMap.get(normalizedPath);

  if (pathAccountId && pathTargets) {
    const byAccountId = pathTargets.find(
      (t) => t.account.accountId === pathAccountId,
    );
    if (byAccountId?.account?.token) {
      const wc = new WecomCrypto(byAccountId.account.token, byAccountId.account.encodingAESKey, byAccountId.account.receiveId);
      const ok = wc.verifySignature(
        signature,
        timestamp,
        nonce,
        encrypt,
        );
      if (ok) return { status: "matched", target: byAccountId };
    }
  }

  const candidates = (pathTargets && pathTargets.length > 0)
    ? pathTargets
    : getRegisteredTargets();

  const signatureMatches = candidates.filter(
    (target) => {
      if (!target?.account?.token) return false;
      const wc = new WecomCrypto(target.account.token, target.account.encodingAESKey, target.account.receiveId);
      return wc.verifySignature(
        signature,
        timestamp,
        nonce,
        encrypt,
      );
    }
  );

  const uniqueMatches = deduplicateByAccountId(signatureMatches);

  if (uniqueMatches.length === 1) {
    return { status: "matched", target: uniqueMatches[0]! };
  }

  const candidateAccountIds = (uniqueMatches.length > 0 ? uniqueMatches : candidates)
    .map((t) => t.account.accountId);

  if (uniqueMatches.length === 0) {
    return { status: "not_found", candidateAccountIds };
  }

  return { status: "conflict", candidateAccountIds };
}

// ============================================================================
// 主入口
// ============================================================================

export async function handleWecomWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const reqId = crypto.randomUUID().slice(0, 8);
  const url = req.url ?? "/";
  const method = (req.method ?? "GET").toUpperCase();
  const remote = req.socket?.remoteAddress ?? "unknown";
  const ua = String(req.headers["user-agent"] ?? "");
  const cl = String(req.headers["content-length"] ?? "");
  const query = parseQuery(url);
  const hasTimestamp = Boolean(query.timestamp);
  const hasNonce = Boolean(query.nonce);
  const hasEchostr = Boolean(query.echostr);
  const signature = resolveSignatureParam(query);
  const hasSig = Boolean(signature);
  console.log(
    `[wecom] inbound(http): reqId=${reqId} path=${url.split("?")[0]} method=${method} remote=${remote} ua=${ua ? `"${ua}"` : "N/A"} contentLength=${cl || "N/A"} query={timestamp:${hasTimestamp},nonce:${hasNonce},echostr:${hasEchostr},signature:${hasSig}}`,
  );

  if (!hasActiveTargets()) {
    console.log(`[wecom] inbound(http): reqId=${reqId} skipped — no active targets`);
    return false;
  }

  const pathAccountId = parseWebhookPath(url);

  // ── GET 请求：URL 验证 ──────────────────────────────────────────
  if (method === "GET") {
    const { timestamp, nonce, echostr } = query;
    const msgSignature = resolveSignatureParam(query);
    if (!msgSignature || !timestamp || !nonce || !echostr) {
      sendText(res, 400, "missing required query parameters");
      return true;
    }

    const matchResult = findMatchingTarget(url, msgSignature, timestamp, nonce, echostr, pathAccountId);
    if (matchResult.status !== "matched") {
      console.log(
        `[wecom] inbound(http): reqId=${reqId} GET route_failure reason=${matchResult.status} candidates=[${matchResult.candidateAccountIds.join(",")}]`,
      );
      sendText(res, 403, "signature verification failed");
      return true;
    }
    const target = matchResult.target;

    target.runtime.log?.(`[webhook] GET URL 验证成功 (account=${target.account.accountId})`);

    try {
      const wc = new WecomCrypto(target.account.token, target.account.encodingAESKey, target.account.receiveId);
      const plaintext = wc.decrypt(echostr);
      sendText(res, 200, plaintext);
    } catch (err) {
      target.runtime.log?.(`[webhook] echostr 解密失败: ${err instanceof Error ? err.message : String(err)}`);
      sendText(res, 403, "decryption failed");
    }
    return true;
  }

  // ── POST 请求：消息回调 ──────────────────────────────────────────
  if (method === "POST") {
    const { timestamp, nonce } = query;
    const msgSignature = resolveSignatureParam(query);
    if (!msgSignature || !timestamp || !nonce) {
      sendJson(res, 400, { error: "missing required query parameters" });
      return true;
    }

    const bodyResult = await readBody(req);
    if (!bodyResult.ok) {
      sendJson(res, 400, { error: bodyResult.error });
      return true;
    }
    const bodyStr = bodyResult.value;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyStr) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return true;
    }

    const encrypt = String(body.encrypt ?? body.Encrypt ?? "");

    console.log(
      `[wecom] inbound(bot): reqId=${reqId} rawJsonBytes=${Buffer.byteLength(bodyStr, "utf8")} hasEncrypt=${Boolean(encrypt)} encryptLen=${encrypt.length}`,
    );

    if (!encrypt) {
      sendJson(res, 400, { error: "missing encrypt field" });
      return true;
    }

    const matchResult = findMatchingTarget(url, msgSignature, timestamp, nonce, encrypt, pathAccountId);
    if (matchResult.status !== "matched") {
      const reason = matchResult.status === "conflict"
        ? "wecom_account_conflict"
        : "wecom_account_not_found";
      const detail = matchResult.status === "conflict"
        ? "Bot callback account conflict: multiple accounts matched signature."
        : "Bot callback account not found: signature verification failed.";
      console.log(
        `[wecom] inbound(bot): reqId=${reqId} route_failure reason=${reason} path=${url.split("?")[0]} candidates=[${matchResult.candidateAccountIds.join(",")}]`,
      );
      sendText(res, 403, detail);
      return true;
    }
    const target = matchResult.target;

    target.runtime.log?.(
      `[webhook] POST 签名验证成功 (account=${target.account.accountId})`,
    );

    target.statusSink?.({ lastInboundAt: Date.now() });

    // 消息解密
    let message: WebhookInboundMessage;
    try {
      const wc = new WecomCrypto(target.account.token, target.account.encodingAESKey, target.account.receiveId);
      const plaintext = wc.decrypt(encrypt);
      message = JSON.parse(plaintext) as WebhookInboundMessage;
    } catch (err) {
      target.runtime.log?.(
        `[webhook] 消息解密失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      sendText(res, 400, "decrypt failed - 解密失败，请检查 EncodingAESKey");
      return true;
    }

    // aibotid 身份校验
    const expectedBotIds = resolveBotIdentitySet(target);
    if (expectedBotIds.size > 0) {
      const inboundAibotId = String(message.aibotid ?? "").trim();
      if (!inboundAibotId || !expectedBotIds.has(inboundAibotId)) {
        target.runtime.error?.(
          `[webhook] aibotid_mismatch: accountId=${target.account.accountId} expected=${Array.from(expectedBotIds).join(",")} actual=${inboundAibotId || "N/A"}`,
        );
      }
    }

    target.runtime.log?.(
      `[webhook] 收到消息 (type=${message.msgtype}, msgid=${message.msgid ?? "N/A"}, account=${target.account.accountId})`,
    );

    const proxyUrl = resolveWeComEgressProxyUrl(target.config);

    // 按消息类型分发
    try {
      const responseData = await dispatchMessage(target, message, timestamp, nonce, proxyUrl);
      if (responseData) {
        const encrypted = encryptResponse(target, responseData, timestamp, nonce);
        sendEncryptedReply(res, encrypted);
      } else {
        const encrypted = encryptResponse(target, {}, timestamp, nonce);
        sendEncryptedReply(res, encrypted);
      }
    } catch (err) {
      target.runtime.error?.(
        `[webhook] 消息处理异常: ${err instanceof Error ? err.message : String(err)}`,
      );
      const errorResponse = {
        msgtype: "text",
        text: { content: "服务内部错误：Bot 处理异常，请稍后重试。" },
      };
      const encrypted = encryptResponse(target, errorResponse, timestamp, nonce);
      sendEncryptedReply(res, encrypted);
    }

    return true;
  }

  return false;
}

// ============================================================================
// 消息分发
// ============================================================================

async function dispatchMessage(
  target: WecomWebhookTarget,
  message: WebhookInboundMessage,
  timestamp: string,
  nonce: string,
  proxyUrl?: string,
): Promise<Record<string, unknown> | null> {
  const msgtype = message.msgtype;

  // stream_refresh 轮询
  if (msgtype === "stream") {
    return handleStreamRefresh(target, message);
  }

  // 事件处理
  if (msgtype === "event") {
    const eventType = String(message.event?.eventtype ?? "").toLowerCase();
    if (eventType === "enter_chat") {
      return handleEnterChat(target, message);
    }
    if (eventType === "template_card_event") {
      return handleTemplateCardEvent(target, message, timestamp, nonce, proxyUrl);
    }
    target.runtime.log?.(`[webhook] 未处理的事件类型: ${eventType}`);
    return null;
  }

  // 普通消息
  if (["text", "image", "file", "voice", "video", "mixed"].includes(msgtype)) {
    const filterResult = shouldProcessBotInboundMessage(message);
    if (!filterResult.shouldProcess) {
      target.runtime.log?.(
        `[webhook] 消息过滤: msgtype=${msgtype} reason=${filterResult.reason} from=${resolveWecomSenderUserId(message) ?? "N/A"} chatType=${String(message.chattype ?? "N/A")}`,
      );
      return null;
    }
    return handleInboundMessage(target, message, timestamp, nonce, proxyUrl, filterResult);
  }

  target.runtime.log?.(`[webhook] 未知消息类型: ${msgtype}`);
  return null;
}
