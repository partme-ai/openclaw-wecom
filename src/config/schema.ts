/**
 * WeCom 配置 Schema (Zod)
 */

import { z } from "zod";

function bindToJsonSchema<T extends z.ZodTypeAny>(schema: T): T {
    const anySchema = schema as unknown as { toJSONSchema?: (...args: any[]) => unknown };
    if (typeof anySchema.toJSONSchema === "function") {
        anySchema.toJSONSchema = anySchema.toJSONSchema.bind(schema) as any;
    }
    return schema;
}

/**
 * **dmSchema (单聊配置)**
 * 
 * 控制单聊行为（如允许名单、策略）。
 * @property enabled - 是否启用单聊 [默认: true]
 * @property policy - 访问策略: "pairing" (需配对, 默认), "allowlist" (仅在名单), "open" (所有人), "disabled" (禁用)
 * @property allowFrom - 允许的用户ID或群ID列表 (仅当 policy="allowlist" 时生效)
 */
const dmSchema = z.object({
    enabled: z.boolean().optional(),
    policy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
}).optional();

/**
 * **mediaSchema (媒体处理配置)**
 * 
 * 控制媒体文件的下载和缓存行为。
 * @property tempDir - 临时文件下载目录
 * @property retentionHours - 临时文件保留时间（小时）
 * @property cleanupOnStart - 启动时是否自动清理旧文件
 * @property maxBytes - 允许下载的最大字节数
 */
const mediaSchema = z.object({
    tempDir: z.string().optional(),
    retentionHours: z.number().optional(),
    cleanupOnStart: z.boolean().optional(),
    maxBytes: z.number().optional(),
}).optional();

/**
 * **networkSchema (网络配置)**
 * 
 * 控制 HTTP 请求行为，特别是出站代理。
 * @property timeoutMs - 请求超时时间 (毫秒)
 * @property retries - 重试次数
 * @property retryDelayMs - 重试间隔 (毫秒)
 * @property egressProxyUrl - 出站 HTTP 代理 (如 "http://127.0.0.1:7890")
 */
const networkSchema = z.object({
    timeoutMs: z.number().optional(),
    retries: z.number().optional(),
    retryDelayMs: z.number().optional(),
    egressProxyUrl: z.string().optional(),
}).optional();

/**
 * **routingSchema (路由策略配置)**
 *
 * 控制未命中 bindings 时的回退行为。
 * @property failClosedOnDefaultRoute - true=拒绝 default 回退，false=允许回退默认 agent
 */
const routingSchema = z.object({
    failClosedOnDefaultRoute: z.boolean().optional(),
}).optional();

/**
 * **botSchema (Bot 模式配置)**
 * 
 * 用于配置企业微信内部机器人 (Webhook 模式)。
 * @property token - 企业微信后台设置的 Token
 * @property encodingAESKey - 企业微信后台设置的 EncodingAESKey
 * @property receiveId - (可选) 接收者ID，通常不用填
 * @property streamPlaceholderContent - (可选) 流式响应中的占位符，默认为 "Thinking..."或空
 * @property welcomeText - (可选) 用户首次对话时的欢迎语
 * @property dm - 单聊策略覆盖配置
 */
const botSchema = z.object({
    aibotid: z.string().optional(),
    token: z.string().optional(),
    encodingAESKey: z.string().optional(),
    botIds: z.array(z.string()).optional(),
    receiveId: z.string().optional(),
    streamPlaceholderContent: z.string().optional(),
    welcomeText: z.string().optional(),
    dm: dmSchema,
    // 长链接模式 (WebSocket)
    connectionMode: z.enum(['webhook', 'websocket']).optional(),
    botId: z.string().optional(),
    secret: z.string().optional(),
}).optional();

/**
 * **agentSchema (Agent 模式配置)**
 * 
 * 用于配置企业微信自建应用 (Agent)。
 * @property corpId - 企业 ID (CorpID)
 * @property corpSecret - 应用 Secret
 * @property agentId - 应用 AgentId (数字，可选)
 * @property token - 回调配置 Token
 * @property encodingAESKey - 回调配置 EncodingAESKey
 * @property welcomeText - (可选) 欢迎语
 * @property dm - 单聊策略覆盖配置
 */
const agentSchema = z.object({
    corpId: z.string(),
    corpSecret: z.string(),
    agentId: z.union([z.string(), z.number()]).optional(),
    token: z.string(),
    encodingAESKey: z.string(),
    welcomeText: z.string().optional(),
    dm: dmSchema,
}).optional();

/**
 * **dynamicAgentsSchema (动态 Agent 配置)**
 *
 * 控制是否按用户/群组自动创建独立 Agent 实例。
 * @property enabled - 是否启用动态 Agent
 * @property dmCreateAgent - 私聊是否为每个用户创建独立 Agent
 * @property groupEnabled - 群聊是否启用动态 Agent
 * @property adminUsers - 管理员列表（绕过动态路由）
 */
/** 知识库来源配置 */
const knowledgeSourceSchema = z.object({
  docIds: z.array(z.string()).optional(),
  docDirs: z.array(z.string()).optional(),
  urls: z.array(z.string()).optional(),
}).optional();

/** 知识库 Embedding 配置 */
const knowledgeEmbeddingSchema = z.object({
  provider: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  dimensions: z.number().optional(),
}).optional();

/** 知识库存储配置 */
const knowledgeStoreSchema = z.object({
  provider: z.string().optional(),
  namespace: z.string().optional(),
  url: z.string().optional(),
  host: z.string().optional(),
  port: z.number().optional(),
  redisUri: z.string().optional(),
  pineconeApiKey: z.string().optional(),
  pineconeEnvironment: z.string().optional(),
  pineconeIndexName: z.string().optional(),
  chromaCollectionName: z.string().optional(),
  weaviateCollectionName: z.string().optional(),
  pgvectorIndexType: z.enum(['ivfflat', 'hnsw']).optional(),
  pgvectorDistanceType: z.enum(['cosine', 'l2', 'inner_product']).optional(),
  pgvectorDimensions: z.number().optional(),
  qdrantCollectionName: z.string().optional(),
  milvusCollectionName: z.string().optional(),
  esIndexName: z.string().optional(),
  dbPath: z.string().optional(),
  sources: knowledgeSourceSchema,
  extra: z.record(z.string(), z.unknown()).optional(),
}).optional();

/** 知识库检索配置 */
const knowledgeRetrievalSchema = z.object({
  strategy: z.enum(['hybrid', 'vector', 'keyword']).optional(),
  topK: z.number().optional(),
  minScore: z.number().min(0).max(1).optional(),
  keywordBoost: z.boolean().optional(),
}).optional();

/** 知识库注入配置 */
const knowledgeInjectionSchema = z.object({
  position: z.enum(['system', 'user']).optional(),
  template: z.string().optional(),
  maxChunks: z.number().optional(),
  maxTokens: z.number().optional(),
}).optional();

/** 知识库审核配置 */
const knowledgeModerationSchema = z.object({
  enabled: z.boolean().optional(),
  rejectionMessage: z.string().optional(),
}).optional();

/** 知识库完整配置 */
const knowledgeSchema = z.object({
  enabled: z.boolean(),
  embedding: knowledgeEmbeddingSchema,
  store: knowledgeStoreSchema,
  retrieval: knowledgeRetrievalSchema,
  injection: knowledgeInjectionSchema,
  moderation: knowledgeModerationSchema,
}).optional();

/** Account 级知识库覆盖配置（所有字段可选） */
const accountKnowledgeSchema = z.object({
  embedding: knowledgeEmbeddingSchema,
  store: knowledgeStoreSchema,
  retrieval: knowledgeRetrievalSchema,
  injection: knowledgeInjectionSchema,
  moderation: knowledgeModerationSchema,
}).optional();

const dynamicAgentsSchema = z.object({
    enabled: z.boolean().optional(),
    dmCreateAgent: z.boolean().optional(),
    groupEnabled: z.boolean().optional(),
    adminUsers: z.array(z.string()).optional(),
}).optional();

/** Matrix 账号条目 */
const accountSchema = z.object({
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    bot: botSchema,
    agent: agentSchema,
    knowledge: accountKnowledgeSchema,
});

/** 顶层 WeCom 配置 Schema */
export const WecomConfigSchema = bindToJsonSchema(z.object({
    enabled: z.boolean().optional(),
    bot: botSchema,
    agent: agentSchema,
    accounts: z.record(z.string(), accountSchema).optional(),
    defaultAccount: z.string().optional(),
    media: mediaSchema,
    network: networkSchema,
    routing: routingSchema,
    dynamicAgents: dynamicAgentsSchema,
    knowledge: knowledgeSchema,
}));

export type WecomConfigInput = z.infer<typeof WecomConfigSchema>;
