/**
 * Knowledge 内核 — 配置合并 + 运行时管理
 *
 * 核心逻辑：
 * 1. deepMergeKnowledgeConfig — 全局配置 + account 级覆盖的深度合并
 * 2. getOrCreateStore — 按 accountId:mode 命名空间获取/创建 VectorStore 实例
 * 3. before_prompt_build hook — 注入 RAG 上下文
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type {
  KnowledgeConfig,
  DeepPartialKnowledgeConfig,
  BeforePromptBuildContext,
  BeforePromptBuildResult,
  EmbeddingService,
  VectorStore,
} from './types.js';
import { OpenAIEmbeddingService } from './embedding/openai.js';
import { createVectorStore, getDefaultStoreConfig } from './store/factory.js';
import { retrieveContext } from './indexer/scheduler.js';
import { hybridSearch } from './retriever/hybrid.js';

// ===================================================================
// 运行时状态
// ===================================================================

/** Store 实例缓存（按 namespace） */
const storeCache = new Map<string, { store: VectorStore; embedding: EmbeddingService; config: KnowledgeConfig }>();

// ===================================================================
// 配置合并
// ===================================================================

/**
 * 深度合并知识库配置
 *
 * 规则：
 * - enabled: 继承全局（如果 account 级没配）
 * - embedding/store/retrieval/injection/moderation: 深度合并
 * - store.sources: 完全替换（不合并）
 */
export function deepMergeKnowledgeConfig(
  global?: KnowledgeConfig,
  accountOverride?: DeepPartialKnowledgeConfig,
): KnowledgeConfig | null {
  if (!global?.enabled) return null;

  const merged: KnowledgeConfig = {
    enabled: true,
    ...global,
  };

  if (!accountOverride) return merged;

  // 深度合并子配置
  const mergeFields = ['embedding', 'retrieval', 'injection', 'moderation'] as const;
  for (const field of mergeFields) {
    const globalField = global[field];
    const overrideField = (accountOverride as any)[field];
    if (overrideField && globalField) {
      (merged as any)[field] = { ...globalField, ...overrideField };
    } else if (overrideField) {
      (merged as any)[field] = overrideField;
    }
  }

  // store 配置：深度合并，但 sources 完全替换
  if (accountOverride.store || global.store) {
    const baseStore = { ...(global.store ?? {}) };
    merged.store = accountOverride.store
      ? { ...baseStore, ...accountOverride.store, sources: accountOverride.store.sources ?? baseStore.sources }
      : baseStore;
  }

  return merged;
}

// ===================================================================
// Store 生命周期管理
// ===================================================================

/**
 * 获取或创建指定命名空间的 VectorStore 实例
 */
export async function getOrCreateStore(
  config: KnowledgeConfig,
  namespace: string,
): Promise<{ store: VectorStore; embedding: EmbeddingService }> {
  const cached = storeCache.get(namespace);
  if (cached) return { store: cached.store, embedding: cached.embedding };

  // 创建 EmbeddingService
  const embedding = new OpenAIEmbeddingService(config.embedding);

  // 创建 VectorStore
  const storeConfig = config.store ?? getDefaultStoreConfig(namespace);
  storeConfig.namespace = namespace;
  const dimensions = config.embedding?.dimensions ?? embedding.dimensions;
  const store = await createVectorStore(storeConfig, dimensions);

  // 缓存
  storeCache.set(namespace, { store, embedding, config });
  return { store, embedding };
}

/**
 * 清除指定命名空间的缓存
 */
export function invalidateStoreCache(namespace?: string): void {
  if (namespace) {
    storeCache.delete(namespace);
  } else {
    storeCache.clear();
  }
}

// ===================================================================
// 配置读取辅助（对接 OpenClaw 配置系统）
// ===================================================================

/**
 * 从 OpenClaw 配置中读取 wecom.knowledge 配置
 * 这里假设配置路径为 channels.wecom.knowledge
 * 实际读取方式由调用方决定
 */
export function extractKnowledgeConfig(
  config: any,
): { global: KnowledgeConfig | undefined; accounts: Record<string, DeepPartialKnowledgeConfig> } {
  const wecom = config?.channels?.wecom;
  if (!wecom) return { global: undefined, accounts: {} };

  const global = wecom.knowledge as KnowledgeConfig | undefined;
  const accounts: Record<string, DeepPartialKnowledgeConfig> = {};

  if (wecom.accounts) {
    for (const [accountId, accountConfig] of Object.entries(wecom.accounts) as [string, any][]) {
      if (accountConfig?.knowledge) {
        accounts[accountId] = accountConfig.knowledge;
      }
    }
  }

  return { global, accounts };
}

// ===================================================================
// before_prompt_build Hook
// ===================================================================

/**
 * 注册知识库 hooks
 */
export function registerKnowledgeHooks(api: OpenClawPluginApi): void {
  api.on('before_prompt_build', (_event: string, ctx: BeforePromptBuildContext): BeforePromptBuildResult | undefined | Promise<BeforePromptBuildResult | undefined> => {
    return handleBeforePromptBuild(ctx);
  });
}

/**
 * before_prompt_build 事件处理器
 *
 * 流程：
 * 1. 仅处理 wecom 通道
 * 2. 读取配置 → 深度合并（全局 + account 覆盖）
 * 3. 获取/创建 VectorStore 实例
 * 4. 如果用户消息不为空，检索相关上下文
 * 5. 注入到 systemPrompt
 */
async function handleBeforePromptBuild(ctx: BeforePromptBuildContext): Promise<BeforePromptBuildResult | undefined> {
  if (ctx.channelId !== 'wecom') return;
  if (!ctx.message) return;

  // 从 ctx 中获取 accountId（OpenClaw 路由绑定传过来的）
  const accountId = ctx.accountId ?? 'default';
  const mode = ctx.agentId ? 'agent' : 'bot';
  const namespace = `${accountId}:${mode}`;

  // 获取配置（这里需要从 OpenClaw 配置系统读取，简化处理）
  const config = await resolveConfigForAccount(ctx, accountId);
  if (!config?.enabled) return;

  try {
    const { store, embedding } = await getOrCreateStore(config, namespace);
    const retrieval = config.retrieval ?? {};
    const topK = retrieval.topK ?? 5;
    const minScore = retrieval.minScore ?? 0.0;
    const injection = config.injection ?? {};

    // 混合检索
    const { contextText } = await hybridSearch(ctx.message, embedding, store, {
      topK,
      minScore,
      config: { strategy: retrieval.strategy ?? 'hybrid' },
    });

    if (!contextText) return;

    // 构建注入文本
    const template = injection.template ?? '以下是相关知识库内容，请据此回答用户问题：\n\n{context}';
    const injectedContext = template.replace('{context}', contextText);

    const position = injection.position ?? 'system';

    if (position === 'user') {
      return {
        userPrompt: injectedContext,
      };
    }

    return {
      systemPrompt: injectedContext,
    };
  } catch (error) {
    console.error('[Knowledge] Error in before_prompt_build:', error);
    return undefined;
  }
}

/**
 * 解析当前 account 的知识库配置
 *
 * 这里需要对接 OpenClaw 的实际配置读取方式。
 * 简化实现：从 ctx 携带的 config 中读取。
 * 实际部署时，应该通过 OpenClaw 配置管理系统获取完整的 wecom 配置。
 */
async function resolveConfigForAccount(
  ctx: BeforePromptBuildContext,
  accountId: string,
): Promise<KnowledgeConfig | null> {
  // 尝试从 ctx 自带的配置中提取
  const config: any = (ctx as any).config;
  if (!config) return null;

  const { global, accounts } = extractKnowledgeConfig(config);
  if (!global) return null;

  const accountOverride = accounts[accountId];
  return deepMergeKnowledgeConfig(global, accountOverride);
}
