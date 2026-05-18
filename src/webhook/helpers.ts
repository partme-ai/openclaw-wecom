/**
 * Webhook 辅助函数
 *
 * 从 @wecom/wecom-openclaw-plugin 迁移，适配 openclaw-wecom。
 * 包含：文本截断、兜底提示构建、本机路径提取、MIME 推断、消息解析等。
 */

import crypto from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { StreamState, WecomWebhookTarget, WebhookInboundMessage, WebhookInboundQuote } from "./types.js";

// ============================================================================
// 常量
// ============================================================================

export const STREAM_MAX_DM_BYTES = 200_000;

export const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  tgz: "application/gzip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  amr: "voice/amr",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

// ============================================================================
// 文本处理
// ============================================================================

export function truncateUtf8Bytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  const slice = buf.subarray(buf.length - maxBytes);
  return slice.toString("utf8");
}

export function appendDmContent(state: StreamState, text: string): void {
  const next = state.dmContent ? `${state.dmContent}\n\n${text}`.trim() : text.trim();
  state.dmContent = truncateUtf8Bytes(next, STREAM_MAX_DM_BYTES);
}

// ============================================================================
// 兜底提示
// ============================================================================

export function buildFallbackPrompt(params: {
  kind: "media" | "timeout" | "error";
  agentConfigured: boolean;
  userId?: string;
  filename?: string;
  chatType?: "group" | "direct";
}): string {
  const who = params.userId ? `（${params.userId}）` : "";
  const scope = params.chatType === "group" ? "群聊" : params.chatType === "direct" ? "私聊" : "会话";
  if (!params.agentConfigured) {
    return `${scope}中需要通过应用私信发送${params.filename ? `（${params.filename}）` : ""}，但管理员尚未配置企业微信自建应用（Agent）通道。请联系管理员配置后再试。${who}`.trim();
  }
  if (!params.userId) {
    return `${scope}中需要通过应用私信兜底发送${params.filename ? `（${params.filename}）` : ""}，但本次回调未能识别触发者 userid（请检查企微回调字段 from.userid / fromuserid）。请联系管理员排查配置。`.trim();
  }
  if (params.kind === "media") {
    return `已生成文件${params.filename ? `（${params.filename}）` : ""}，将通过应用私信发送给你。${who}`.trim();
  }
  if (params.kind === "timeout") {
    return `内容较长，为避免超时，后续内容将通过应用私信发送给你。${who}`.trim();
  }
  return `交付出现异常，已尝试通过应用私信发送给你。${who}`.trim();
}

// ============================================================================
// 本机路径提取
// ============================================================================

export function extractLocalFilePathsFromText(text: string): string[] {
  if (!text.trim()) return [];
  const re = new RegExp(String.raw`(\/(?:Users|tmp|root|home)\/[^\s"'<>　-〿＀-￯一-鿿㐀-䶿]+)`, "g");
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const p = m[1];
    if (p) found.add(p);
  }
  return Array.from(found);
}

export function extractLocalImagePathsFromText(params: {
  text: string;
  mustAlsoAppearIn: string;
}): string[] {
  const { text, mustAlsoAppearIn } = params;
  if (!text.trim()) return [];
  const exts = "(png|jpg|jpeg|gif|webp|bmp)";
  const re = new RegExp(String.raw`(\/(?:Users|tmp|root|home)\/[^\s"'<>]+?\.${exts})`, "gi");
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const p = m[1];
    if (!p) continue;
    if (!mustAlsoAppearIn.includes(p)) continue;
    found.add(p);
  }
  return Array.from(found);
}

export function looksLikeSendLocalFileIntent(rawBody: string): boolean {
  const t = rawBody.trim();
  if (!t) return false;
  return /(发送|发给|发到|转发|把.*发|把.*发送|帮我发|给我发)/.test(t);
}

// ============================================================================
// taskKey 与 Agent 配置
// ============================================================================

export function computeTaskKey(target: WecomWebhookTarget, msg: WebhookInboundMessage): string | undefined {
  const msgid = msg.msgid ? String(msg.msgid) : "";
  if (!msgid) return undefined;
  const aibotid = String(msg.aibotid ?? "unknown").trim() || "unknown";
  return `bot:${target.account.accountId}:${aibotid}:${msgid}`;
}

export function isAgentConfigured(target: WecomWebhookTarget): boolean {
  return Boolean(target.account.agent?.configured);
}

export function guessContentTypeFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  return MIME_BY_EXT[ext];
}

// ============================================================================
// Stream Reply 构建
// ============================================================================

export function buildStreamReplyFromState(state: StreamState, maxBytes: number): Record<string, unknown> {
  const content = truncateUtf8Bytes(state.content, maxBytes);
  const result: Record<string, unknown> = {
    msgtype: "stream",
    stream: {
      id: state.streamId,
      finish: state.finished,
      content,
      ...(state.finished && state.images?.length ? {
        msg_item: state.images.map((img) => ({
          msgtype: "image",
          image: { base64: img.base64, md5: img.md5 },
        })),
      } : {}),
    },
  };
  return result;
}

export function computeMd5(data: Buffer | string): string {
  return crypto.createHash("md5").update(data).digest("hex");
}

// ============================================================================
// 配置解析
// ============================================================================

export function resolveWecomMediaMaxBytes(cfg: OpenClawConfig): number {
  const val = (cfg.channels?.wecom as any)?.media?.maxBytes;
  if (typeof val === "number" && Number.isFinite(val) && val > 0) return val;
  return 20 * 1024 * 1024; // 默认 20MB
}

// ============================================================================
// 入站消息处理（processInboundMessage）
// ============================================================================

export type InboundResult = {
  body: string;
  media?: {
    buffer: Buffer;
    contentType: string;
    filename: string;
  };
};

export async function processInboundMessage(
  target: WecomWebhookTarget,
  msg: WebhookInboundMessage,
): Promise<InboundResult> {
  const { decryptWecomMediaWithMeta } = await import("./media.js");
  const { resolveWeComEgressProxyUrl } = await import("../config/network.js");

  const msgtype = String(msg.msgtype ?? "").toLowerCase();
  const globalAesKey = target.account.encodingAESKey;
  const maxBytes = resolveWecomMediaMaxBytes(target.config);
  const proxyUrl = resolveWeComEgressProxyUrl(target.config);

  // 图片消息处理
  if (msgtype === "image") {
    const url = String((msg as any).image?.url ?? "").trim();
    const aesKey = globalAesKey || (msg as any).image?.aeskey || "";
    if (url && aesKey) {
      try {
        const decrypted = await decryptWecomMediaWithMeta(url, aesKey, { maxBytes, http: { proxyUrl } });
        const inferred = inferInboundMediaMeta({
          kind: "image",
          buffer: decrypted.buffer,
          sourceUrl: decrypted.sourceUrl || url,
          sourceContentType: decrypted.sourceContentType,
          sourceFilename: decrypted.sourceFilename,
          explicitFilename: pickBotFileName(msg),
        });
        return {
          body: "[image]",
          media: {
            buffer: decrypted.buffer,
            contentType: inferred.contentType,
            filename: inferred.filename,
          },
        };
      } catch (err) {
        target.runtime.error?.(`Failed to decrypt inbound image: ${String(err)}`);
        const errorMessage = formatDecryptError(err);
        return { body: `[image] (decryption failed: ${errorMessage})` };
      }
    }
  }

  // 文件消息处理
  if (msgtype === "file") {
    const url = String((msg as any).file?.url ?? "").trim();
    const aesKey = globalAesKey || (msg as any).file?.aeskey || "";
    if (url && aesKey) {
      try {
        const decrypted = await decryptWecomMediaWithMeta(url, aesKey, { maxBytes, http: { proxyUrl } });
        const inferred = inferInboundMediaMeta({
          kind: "file",
          buffer: decrypted.buffer,
          sourceUrl: decrypted.sourceUrl || url,
          sourceContentType: decrypted.sourceContentType,
          sourceFilename: decrypted.sourceFilename,
          explicitFilename: pickBotFileName(msg),
        });
        return {
          body: "[file]",
          media: {
            buffer: decrypted.buffer,
            contentType: inferred.contentType,
            filename: inferred.filename,
          },
        };
      } catch (err) {
        target.runtime.error?.(
          `Failed to decrypt inbound file: ${String(err)}; 可调大 channels.wecom.media.maxBytes（当前=${maxBytes}）`,
        );
        const errorMessage = formatDecryptError(err);
        return { body: `[file] (decryption failed: ${errorMessage})` };
      }
    }
  }

  // 视频消息处理
  if (msgtype === "video") {
    const url = String((msg as any).video?.url ?? "").trim();
    const aesKey = globalAesKey || (msg as any).video?.aeskey || "";
    if (url && aesKey) {
      try {
        const decrypted = await decryptWecomMediaWithMeta(url, aesKey, { maxBytes, http: { proxyUrl } });
        const inferred = inferInboundMediaMeta({
          kind: "file",
          buffer: decrypted.buffer,
          sourceUrl: decrypted.sourceUrl || url,
          sourceContentType: decrypted.sourceContentType,
          sourceFilename: decrypted.sourceFilename,
          explicitFilename: pickBotFileName(msg),
        });
        return {
          body: `[video] 视频文件已保存，文件名: ${inferred.filename}`,
          media: {
            buffer: decrypted.buffer,
            contentType: inferred.contentType,
            filename: inferred.filename,
          },
        };
      } catch (err) {
        target.runtime.error?.(
          `Failed to decrypt inbound video: ${String(err)}; 可调大 channels.wecom.media.maxBytes（当前=${maxBytes}）`,
        );
        const errorMessage = formatDecryptError(err);
        return { body: `[video] (decryption failed: ${errorMessage})` };
      }
    }
  }

  // Mixed 消息处理
  if (msgtype === "mixed") {
    const items = (msg as any).mixed?.msg_item;
    if (Array.isArray(items)) {
      let foundMedia: InboundResult["media"] | undefined = undefined;
      const bodyParts: string[] = [];

      for (const item of items) {
        const t = String(item.msgtype ?? "").toLowerCase();
        if (t === "text") {
          const content = String(item.text?.content ?? "").trim();
          if (content) bodyParts.push(content);
        } else if ((t === "image" || t === "file") && !foundMedia) {
          const itemAesKey = globalAesKey || item[t]?.aeskey || "";
          const url = String(item[t]?.url ?? "").trim();
          if (!itemAesKey) {
            bodyParts.push(`[${t}]`);
          } else if (url) {
            try {
              const decrypted = await decryptWecomMediaWithMeta(url, itemAesKey, { maxBytes, http: { proxyUrl } });
              const inferred = inferInboundMediaMeta({
                kind: t,
                buffer: decrypted.buffer,
                sourceUrl: decrypted.sourceUrl || url,
                sourceContentType: decrypted.sourceContentType,
                sourceFilename: decrypted.sourceFilename,
                explicitFilename: pickBotFileName(msg, item?.[t]),
              });
              foundMedia = {
                buffer: decrypted.buffer,
                contentType: inferred.contentType,
                filename: inferred.filename,
              };
              bodyParts.push(`[${t}]`);
            } catch (err) {
              target.runtime.error?.(
                `Failed to decrypt mixed ${t}: ${String(err)}; 可调大 channels.wecom.media.maxBytes（当前=${maxBytes}）`,
              );
              const errorMessage = formatDecryptError(err);
              bodyParts.push(`[${t}] (decryption failed: ${errorMessage})`);
            }
          } else {
            bodyParts.push(`[${t}]`);
          }
        } else {
          bodyParts.push(`[${t}]`);
        }
      }
      return {
        body: bodyParts.join("\n"),
        media: foundMedia,
      };
    }
  }

  // 其他消息类型
  return { body: buildInboundBody(msg) };
}

// ============================================================================
// processInboundMessage 依赖的辅助函数
// ============================================================================

function formatDecryptError(err: unknown): string {
  if (typeof err === "object" && err) {
    const msg = (err as any).message ?? String(err);
    const cause = (err as any).cause;
    return cause ? `${msg} (cause: ${String(cause)})` : String(msg);
  }
  return String(err);
}

function pickBotFileName(msg: WebhookInboundMessage, item?: Record<string, any>): string | undefined {
  const fromItem = item
    ? resolveInlineFileName(
      item?.filename ??
      item?.file_name ??
      item?.fileName ??
      item?.name ??
      item?.title,
    )
    : undefined;
  if (fromItem) return fromItem;

  const fromFile = resolveInlineFileName(
    (msg as any)?.file?.filename ??
    (msg as any)?.file?.file_name ??
    (msg as any)?.file?.fileName ??
    (msg as any)?.file?.name ??
    (msg as any)?.file?.title ??
    (msg as any)?.filename ??
    (msg as any)?.fileName ??
    (msg as any)?.FileName,
  );
  return fromFile;
}

function resolveInlineFileName(input: unknown): string | undefined {
  const raw = String(input ?? "").trim();
  return sanitizeInboundFilename(raw);
}

function sanitizeInboundFilename(raw?: string): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  const base = s.split(/[\\/]/).pop()?.trim() ?? "";
  if (!base) return undefined;
  const sanitized = base.replace(/[ -<>:"|?*]/g, "_").trim();
  return sanitized || undefined;
}

function extractFileNameFromUrl(rawUrl?: string): string | undefined {
  const s = String(rawUrl ?? "").trim();
  if (!s) return undefined;
  try {
    const u = new URL(s);
    const name = decodeURIComponent(u.pathname.split("/").pop() ?? "").trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

function hasLikelyExtension(name?: string): boolean {
  if (!name) return false;
  return /\.[a-z0-9]{1,16}$/i.test(name);
}

function normalizeContentType(raw?: string | null): string | undefined {
  const normalized = String(raw ?? "").trim().split(";")[0]?.trim().toLowerCase();
  return normalized || undefined;
}

const GENERIC_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/download",
]);

function isGenericContentType(raw?: string | null): boolean {
  const normalized = normalizeContentType(raw);
  if (!normalized) return true;
  return GENERIC_CONTENT_TYPES.has(normalized);
}

const EXT_BY_MIME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext])),
  "application/octet-stream": "bin",
};

function guessExtensionFromContentType(contentType?: string): string | undefined {
  const normalized = normalizeContentType(contentType);
  if (!normalized) return undefined;
  if (normalized === "image/jpeg") return "jpg";
  return EXT_BY_MIME[normalized];
}

function detectMimeFromBufferSync(buffer: Buffer): string | undefined {
  if (!buffer || buffer.length < 4) return undefined;

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return "image/png";

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";

  if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";

  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";

  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp";

  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";

  if (buffer.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg";

  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";

  if (buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0)) return "audio/mpeg";

  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") return "video/mp4";

  if (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 && buffer[5] === 0xb1 && buffer[6] === 0x1a && buffer[7] === 0xe1
  ) return "application/msword";

  const zipMagic =
    (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) ||
    (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x05 && buffer[3] === 0x06) ||
    (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x07 && buffer[3] === 0x08);
  if (zipMagic) {
    const probe = buffer.subarray(0, Math.min(buffer.length, 512 * 1024));
    if (probe.includes(Buffer.from("word/"))) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (probe.includes(Buffer.from("xl/"))) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (probe.includes(Buffer.from("ppt/"))) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    return "application/zip";
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let printable = 0;
  for (const b of sample) {
    if (b === 0x00) return undefined;
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) {
      printable += 1;
    }
  }
  if (sample.length > 0 && printable / sample.length > 0.95) return "text/plain";

  return undefined;
}

function inferInboundMediaMeta(params: {
  kind: "image" | "file";
  buffer: Buffer;
  sourceUrl?: string;
  sourceContentType?: string;
  sourceFilename?: string;
  explicitFilename?: string;
}): { contentType: string; filename: string } {
  const headerType = normalizeContentType(params.sourceContentType);
  const magicType = detectMimeFromBufferSync(params.buffer);
  const rawUrlName = sanitizeInboundFilename(extractFileNameFromUrl(params.sourceUrl));
  const guessedByUrl = hasLikelyExtension(rawUrlName) ? rawUrlName : undefined;
  const explicitName = sanitizeInboundFilename(params.explicitFilename);
  const sourceName = sanitizeInboundFilename(params.sourceFilename);
  const chosenName = explicitName || sourceName || guessedByUrl;
  const typeByName = chosenName ? guessContentTypeFromPath(chosenName) : undefined;

  let contentType: string;
  if (params.kind === "image") {
    if (magicType?.startsWith("image/")) contentType = magicType;
    else if (headerType?.startsWith("image/")) contentType = headerType;
    else if (typeByName?.startsWith("image/")) contentType = typeByName;
    else contentType = "image/jpeg";
  } else {
    contentType =
      magicType ||
      (!isGenericContentType(headerType) ? headerType! : undefined) ||
      typeByName ||
      "application/octet-stream";
  }

  const hasExt = Boolean(chosenName && /\.[a-z0-9]{1,16}$/i.test(chosenName));
  const ext = guessExtensionFromContentType(contentType) || (params.kind === "image" ? "jpg" : "bin");
  const filename = chosenName
    ? (hasExt ? chosenName : `${chosenName}.${ext}`)
    : `${params.kind}.${ext}`;

  return { contentType, filename };
}


// ============================================================================
// 配置解析
// ============================================================================

export function buildCfgForDispatch(config: OpenClawConfig): OpenClawConfig {
  const baseAgents = (config as any)?.agents ?? {};
  const baseAgentDefaults = (baseAgents as any)?.defaults ?? {};
  const baseBlockChunk = (baseAgentDefaults as any)?.blockStreamingChunk ?? {};
  const baseBlockCoalesce = (baseAgentDefaults as any)?.blockStreamingCoalesce ?? {};
  const baseTools = (config as any)?.tools ?? {};
  const baseSandbox = (baseTools as any)?.sandbox ?? {};
  const baseSandboxTools = (baseSandbox as any)?.tools ?? {};
  const existingTopLevelDeny = Array.isArray((baseTools as any).deny) ? ((baseTools as any).deny as string[]) : [];
  const existingSandboxDeny = Array.isArray((baseSandboxTools as any).deny) ? ((baseSandboxTools as any).deny as string[]) : [];
  const topLevelDeny = Array.from(new Set([...existingTopLevelDeny, "message"]));
  const sandboxDeny = Array.from(new Set([...existingSandboxDeny, "message"]));
  return {
    ...(config as any),
    agents: {
      ...baseAgents,
      defaults: {
        ...baseAgentDefaults,
        blockStreamingChunk: {
          ...baseBlockChunk,
          minChars: baseBlockChunk.minChars ?? 120,
          maxChars: baseBlockChunk.maxChars ?? 360,
          breakPreference: baseBlockChunk.breakPreference ?? "sentence",
        },
        blockStreamingCoalesce: {
          ...baseBlockCoalesce,
          minChars: baseBlockCoalesce.minChars ?? 120,
          maxChars: baseBlockCoalesce.maxChars ?? 360,
          idleMs: baseBlockCoalesce.idleMs ?? 250,
        },
      },
    },
    tools: {
      ...baseTools,
      deny: topLevelDeny,
      sandbox: {
        ...baseSandbox,
        tools: {
          ...baseSandboxTools,
          deny: sandboxDeny,
        },
      },
    },
  } as OpenClawConfig;
}


export function resolveWecomSenderUserId(msg: WebhookInboundMessage): string | undefined {
  const direct = msg.from?.userid?.trim();
  if (direct) return direct;
  const rawMsg = msg as unknown as Record<string, unknown>;
  const legacy = String(rawMsg.fromuserid ?? rawMsg.from_userid ?? rawMsg.fromUserId ?? "").trim();
  return legacy || undefined;
}


// ============================================================================
// buildInboundBody 等消息解析函数
// ============================================================================

export function buildInboundBody(msg: WebhookInboundMessage): string {
  let body = "";
  const msgtype = String(msg.msgtype ?? "").toLowerCase();

  if (msgtype === "text") {
    body = msg.text?.content || "";
  } else if (msgtype === "voice") {
    body = msg.voice?.content || "[voice]";
  } else if (msgtype === "mixed") {
    const items = msg.mixed?.msg_item;
    if (Array.isArray(items)) {
      body = items.map((item) => {
        const t = String(item?.msgtype ?? "").toLowerCase();
        if (t === "text") return item?.text?.content || "";
        if (t === "image") return `[image] ${item?.image?.url || ""}`;
        return `[${t || "item"}]`;
      }).filter(Boolean).join("\n");
    } else {
      body = "[mixed]";
    }
  } else if (msgtype === "image") {
    body = `[image] ${msg.image?.url || ""}`;
  } else if (msgtype === "file") {
    body = `[file] ${msg.file?.url || ""}`;
  } else if (msgtype === "video") {
    body = `[video] ${msg.video?.url || ""}`;
  } else if (msgtype === "event") {
    body = `[event] ${msg.event?.eventtype || ""}`;
  } else if (msgtype === "stream") {
    body = `[stream_refresh] ${msg.stream?.id || ""}`;
  } else {
    body = msgtype ? `[${msgtype}]` : "";
  }

  const quote = msg.quote;
  if (quote) {
    const quoteText = formatQuote(quote).trim();
    if (quoteText) body += `\n\n> ${quoteText}`;
  }

  return body;
}

export function formatQuote(quote: WebhookInboundQuote): string {
  const type = quote.msgtype ?? "";
  if (type === "text") return quote.text?.content || "";
  if (type === "image") return `[引用: 图片] ${quote.image?.url || ""}`;
  if (type === "mixed" && quote.mixed?.msg_item) {
    const items = quote.mixed.msg_item.map((item) => {
      if (item.msgtype === "text") return item.text?.content;
      if (item.msgtype === "image") return `[图片] ${item.image?.url || ""}`;
      return "";
    }).filter(Boolean).join(" ");
    return `[引用: 图文] ${items}`;
  }
  if (type === "voice") return `[引用: 语音] ${quote.voice?.content || ""}`;
  if (type === "file") return `[引用: 文件] ${quote.file?.url || ""}`;
  if (type === "video") return `[引用: 视频] ${quote.video?.url || ""}`;
  return "";
}

export function hasMedia(message: WebhookInboundMessage): boolean {
  const type = message.msgtype;
  return ["image", "file", "voice", "video"].includes(type) ||
    (type === "mixed" && message.mixed?.msg_item?.some(
      (item) => item.msgtype !== "text",
    ) === true);
}

export function buildStreamPlaceholderReply(
  streamId: string,
  placeholderContent?: string,
): Record<string, unknown> {
  const content = placeholderContent?.trim() || "1";
  return {
    msgtype: "stream",
    stream: {
      id: streamId,
      finish: false,
      content,
    },
  };
}

export function buildStreamTextPlaceholderReply(
  streamId: string,
  content: string,
): Record<string, unknown> {
  return {
    msgtype: "stream",
    stream: {
      id: streamId,
      finish: false,
      content: content.trim() || "1",
    },
  };
}

export function buildStreamResponse(stream: StreamState): Record<string, unknown> {
  const response: Record<string, unknown> = {
    msgtype: "stream",
    stream: {
      id: stream.streamId,
      finish: stream.finished,
      content: stream.content,
    },
  };

  if (stream.images && stream.images.length > 0) {
    const streamObj = response.stream as Record<string, unknown>;
    streamObj.msg_item = stream.images.map((img) => ({
      msgtype: "image",
      image: { base64: img.base64, md5: img.md5 },
    }));
  }

  return response;
}
