/**
 * Webhook 模式状态管理
 *
 * 从 @wecom/wecom-openclaw-plugin 迁移，适配 openclaw-wecom。
 * 包含 StreamStore（流状态存储）、ActiveReplyStore（主动回复地址存储）、MonitorState（全局容器）。
 */

import crypto from "node:crypto";
import type {
  StreamState,
  PendingInbound,
  ActiveReplyState,
  WecomWebhookTarget,
  WebhookInboundMessage,
} from "./types.js";

// ============================================================================
// 常量
// ============================================================================

export const LIMITS = {
  STREAM_TTL_MS: 10 * 60 * 1000,
  ACTIVE_REPLY_TTL_MS: 60 * 60 * 1000,
  DEFAULT_DEBOUNCE_MS: 500,
  STREAM_MAX_BYTES: 20_480,
  REQUEST_TIMEOUT_MS: 15_000,
};

// ============================================================================
// StreamStore
// ============================================================================

/**
 * **StreamStore (流状态会话存储)**
 *
 * 管理企业微信回调的流式会话状态、消息去重和防抖聚合逻辑。
 */
export class StreamStore {
    private streams = new Map<string, StreamState>();
    private msgidToStreamId = new Map<string, string>();
    private pendingInbounds = new Map<string, PendingInbound>();
    private conversationState = new Map<string, { activeBatchKey: string; queue: string[]; nextSeq: number }>();
    private streamIdToBatchKey = new Map<string, string>();
    private batchStreamIdToAckStreamIds = new Map<string, string[]>();
    private onFlush?: (pending: PendingInbound) => void;

    public setFlushHandler(handler: (pending: PendingInbound) => void): void {
        this.onFlush = handler;
    }

    createStream(params: { msgid?: string; conversationKey?: string; batchKey?: string }): string {
        const streamId = crypto.randomBytes(16).toString("hex");

        if (params.msgid) {
            this.msgidToStreamId.set(String(params.msgid), streamId);
        }

        this.streams.set(streamId, {
            streamId,
            msgid: params.msgid,
            conversationKey: params.conversationKey,
            batchKey: params.batchKey,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            started: false,
            finished: false,
            content: ""
        });

        if (params.batchKey) {
            this.streamIdToBatchKey.set(streamId, params.batchKey);
        }

        return streamId;
    }

    getStream(streamId: string): StreamState | undefined {
        return this.streams.get(streamId);
    }

    getStreamByMsgId(msgid: string): string | undefined {
        return this.msgidToStreamId.get(String(msgid));
    }

    setStreamIdForMsgId(msgid: string, streamId: string): void {
        const key = String(msgid).trim();
        const value = String(streamId).trim();
        if (!key || !value) return;
        this.msgidToStreamId.set(key, value);
    }

    addAckStreamForBatch(params: { batchStreamId: string; ackStreamId: string }): void {
        const batchStreamId = params.batchStreamId.trim();
        const ackStreamId = params.ackStreamId.trim();
        if (!batchStreamId || !ackStreamId) return;
        const list = this.batchStreamIdToAckStreamIds.get(batchStreamId) ?? [];
        list.push(ackStreamId);
        this.batchStreamIdToAckStreamIds.set(batchStreamId, list);
    }

    drainAckStreamsForBatch(batchStreamId: string): string[] {
        const key = batchStreamId.trim();
        if (!key) return [];
        const list = this.batchStreamIdToAckStreamIds.get(key) ?? [];
        this.batchStreamIdToAckStreamIds.delete(key);
        return list;
    }

    updateStream(streamId: string, mutator: (state: StreamState) => void): void {
        const state = this.streams.get(streamId);
        if (state) {
            mutator(state);
            state.updatedAt = Date.now();
        }
    }

    markStarted(streamId: string): void {
        this.updateStream(streamId, (s) => { s.started = true; });
    }

    markFinished(streamId: string): void {
        this.updateStream(streamId, (s) => { s.finished = true; });
    }

    addPendingMessage(params: {
        conversationKey: string;
        target: WecomWebhookTarget;
        msg: WebhookInboundMessage;
        msgContent: string;
        nonce: string;
        timestamp: string;
        debounceMs?: number;
    }): { streamId: string; status: "active_new" | "active_merged" | "queued_new" | "queued_merged" } {
        const { conversationKey, target, msg, msgContent, nonce, timestamp, debounceMs } = params;
        const effectiveDebounceMs = debounceMs ?? LIMITS.DEFAULT_DEBOUNCE_MS;

        const state = this.conversationState.get(conversationKey);
        if (!state) {
            // 第一批次（active）
            const batchKey = conversationKey;
            const streamId = this.createStream({ msgid: msg.msgid, conversationKey, batchKey });
            const pending: PendingInbound = {
                streamId,
                conversationKey,
                batchKey,
                target,
                msg,
                contents: [msgContent],
                msgids: msg.msgid ? [msg.msgid] : [],
                nonce,
                timestamp,
                createdAt: Date.now(),
                timeout: setTimeout(() => {
                    this.requestFlush(batchKey);
                }, effectiveDebounceMs)
            };
            this.pendingInbounds.set(batchKey, pending);
            this.conversationState.set(conversationKey, { activeBatchKey: batchKey, queue: [], nextSeq: 1 });
            return { streamId, status: "active_new" };
        }

        // 合并规则（排队语义）
        const activeBatchKey = state.activeBatchKey;
        const activeIsInitial = activeBatchKey === conversationKey;
        const activePending = this.pendingInbounds.get(activeBatchKey);
        if (activePending && !activeIsInitial) {
            const activeStream = this.streams.get(activePending.streamId);
            const activeStarted = Boolean(activeStream?.started);
            if (!activeStarted) {
                activePending.contents.push(msgContent);
                if (msg.msgid) {
                    activePending.msgids.push(msg.msgid);
                }
                if (activePending.timeout) clearTimeout(activePending.timeout);
                activePending.timeout = setTimeout(() => {
                    this.requestFlush(activeBatchKey);
                }, effectiveDebounceMs);
                return { streamId: activePending.streamId, status: "active_merged" };
            }
        }

        // active 批次已开始处理；后续消息进入队列批次
        const queuedBatchKey = state.queue[0];
        if (queuedBatchKey) {
            const existingQueued = this.pendingInbounds.get(queuedBatchKey);
            if (existingQueued) {
                existingQueued.contents.push(msgContent);
                if (msg.msgid) {
                    existingQueued.msgids.push(msg.msgid);
                }
                if (existingQueued.timeout) clearTimeout(existingQueued.timeout);

                existingQueued.timeout = setTimeout(() => {
                    this.requestFlush(queuedBatchKey);
                }, effectiveDebounceMs);
                return { streamId: existingQueued.streamId, status: "queued_merged" };
            }
        }

        // 创建新的 queued 批次
        const seq = state.nextSeq++;
        const batchKey = `${conversationKey}#q${seq}`;
        state.queue = [batchKey];
        const streamId = this.createStream({ msgid: msg.msgid, conversationKey, batchKey });
        const pending: PendingInbound = {
            streamId,
            conversationKey,
            batchKey,
            target,
            msg,
            contents: [msgContent],
            msgids: msg.msgid ? [msg.msgid] : [],
            nonce,
            timestamp,
            createdAt: Date.now(),
            timeout: setTimeout(() => {
                this.requestFlush(batchKey);
            }, effectiveDebounceMs)
        };
        this.pendingInbounds.set(batchKey, pending);
        this.conversationState.set(conversationKey, state);
        return { streamId, status: "queued_new" };
    }

    private requestFlush(batchKey: string): void {
        const pending = this.pendingInbounds.get(batchKey);
        if (!pending) return;

        const state = this.conversationState.get(pending.conversationKey);
        const isActive = state?.activeBatchKey === batchKey;
        if (!isActive) {
            if (pending.timeout) {
                clearTimeout(pending.timeout);
                pending.timeout = null;
            }
            pending.readyToFlush = true;
            return;
        }
        this.flushPending(batchKey);
    }

    private flushPending(pendingKey: string): void {
        const pending = this.pendingInbounds.get(pendingKey);
        if (!pending) return;

        this.pendingInbounds.delete(pendingKey);
        if (pending.timeout) {
            clearTimeout(pending.timeout);
            pending.timeout = null;
        }
        pending.readyToFlush = false;

        if (this.onFlush) {
            this.onFlush(pending);
        }
    }

    onStreamFinished(streamId: string): void {
        const batchKey = this.streamIdToBatchKey.get(streamId);
        const state = batchKey ? this.streams.get(streamId) : undefined;
        const conversationKey = state?.conversationKey;
        if (!batchKey || !conversationKey) return;

        const conv = this.conversationState.get(conversationKey);
        if (!conv) return;
        if (conv.activeBatchKey !== batchKey) return;

        const next = conv.queue.shift();
        if (!next) {
            this.conversationState.delete(conversationKey);
            return;
        }
        conv.activeBatchKey = next;
        this.conversationState.set(conversationKey, conv);

        const pending = this.pendingInbounds.get(next);
        if (!pending) return;
        if (pending.readyToFlush) {
            this.flushPending(next);
        }
    }

    prune(now: number = Date.now()): void {
        const streamCutoff = now - LIMITS.STREAM_TTL_MS;

        for (const [id, state] of this.streams.entries()) {
            if (state.updatedAt < streamCutoff) {
                this.streams.delete(id);
                if (state.msgid) {
                    if (this.msgidToStreamId.get(state.msgid) === id) {
                        this.msgidToStreamId.delete(state.msgid);
                    }
                }
            }
        }

        for (const [msgid, id] of this.msgidToStreamId.entries()) {
            if (!this.streams.has(id)) {
                this.msgidToStreamId.delete(msgid);
            }
        }

        for (const [key, pending] of this.pendingInbounds.entries()) {
            if (now - pending.createdAt > LIMITS.STREAM_TTL_MS) {
                if (pending.timeout) clearTimeout(pending.timeout);
                this.pendingInbounds.delete(key);
            }
        }

        for (const [convKey, conv] of this.conversationState.entries()) {
            const activeExists = this.pendingInbounds.has(conv.activeBatchKey) || Array.from(this.streamIdToBatchKey.values()).includes(conv.activeBatchKey);
            const hasQueue = conv.queue.length > 0;
            if (!activeExists && !hasQueue) {
                this.conversationState.delete(convKey);
            }
        }
    }
}

/**
 * **ActiveReplyStore (主动回复地址存储)**
 *
 * 管理企业微信回调中的 `response_url`。
 */
export class ActiveReplyStore {
    private activeReplies = new Map<string, ActiveReplyState>();

    constructor(private policy: "once" | "multi" = "once") { }

    store(streamId: string, responseUrl?: string, proxyUrl?: string): void {
        const url = responseUrl?.trim();
        if (!url) return;
        this.activeReplies.set(streamId, { response_url: url, proxyUrl, createdAt: Date.now() });
    }

    getUrl(streamId: string): string | undefined {
        return this.activeReplies.get(streamId)?.response_url;
    }

    getProxyUrl(streamId: string): string | undefined {
        return this.activeReplies.get(streamId)?.proxyUrl;
    }

    async use(streamId: string, fn: (params: { responseUrl: string; proxyUrl?: string }) => Promise<void>): Promise<void> {
        const state = this.activeReplies.get(streamId);
        if (!state?.response_url) {
            return;
        }

        if (this.policy === "once" && state.usedAt) {
            throw new Error(`response_url already used for stream ${streamId} (Policy: once)`);
        }

        try {
            await fn({ responseUrl: state.response_url, proxyUrl: state.proxyUrl });
            state.usedAt = Date.now();
        } catch (err: unknown) {
            state.lastError = err instanceof Error ? err.message : String(err);
            throw err;
        }
    }

    prune(now: number = Date.now()): void {
        const cutoff = now - LIMITS.ACTIVE_REPLY_TTL_MS;
        for (const [id, state] of this.activeReplies.entries()) {
            if (state.createdAt < cutoff) {
                this.activeReplies.delete(id);
            }
        }
    }
}

/**
 * **MonitorState (全局监控状态容器)**
 *
 * 模块单例，统一管理 StreamStore 和 ActiveReplyStore 实例。
 */
export class WebhookMonitorState {
    public readonly streamStore = new StreamStore();
    public readonly activeReplyStore = new ActiveReplyStore("multi");

    private pruneInterval?: NodeJS.Timeout;

    public startPruning(intervalMs: number = 60_000): void {
        if (this.pruneInterval) return;
        this.pruneInterval = setInterval(() => {
            const now = Date.now();
            this.streamStore.prune(now);
            this.activeReplyStore.prune(now);
        }, intervalMs);
    }

    public stopPruning(): void {
        if (this.pruneInterval) {
            clearInterval(this.pruneInterval);
            this.pruneInterval = undefined;
        }
    }
}

/**
 * **monitorState (全局单例)**
 */
export const monitorState = new WebhookMonitorState();
