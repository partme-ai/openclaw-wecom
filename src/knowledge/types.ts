/**
 * 知识库模块核心类型定义
 *
 * 设计原则：
 * - Embedding 接口抽象化：仅定义 contract，后端可无缝切换
 * - VectorStore 接口抽象化：支持多种向量数据库
 * - 所有类型均为纯数据对象，不含业务逻辑
 */

// ===================================================================
// Embedding 相关
// ===================================================================

/** Embedding 请求 */
export type EmbeddingRequest = {
  /** 输入文本 */
  input: string | string[];
  /** 模型名称（可选，默认使用配置中的 embedding model） */
  model?: string;
};

/** Embedding 响应 */
export type EmbeddingResponse = {
  /** 向量数据 */
  data: { embedding: number[]; index: number }[];
  /** 使用的模型 */
  model: string;
  /** 消耗的 token 数 */
  usage: { promptTokens: number; totalTokens: number };
};

/** Embedding Service 接口 */
export interface EmbeddingService {
  /** 嵌入维度 */
  readonly dimensions: number;
  /** 模型名称 */
  readonly modelName: string;

  /** 单文本嵌入 */
  embed(text: string): Promise<number[]>;
  /** 批量文本嵌入 */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** 健康检查 */
  health(): Promise<boolean>;
}

// ===================================================================
// Vector Store 相关
// ===================================================================

/** 向量块元数据 */
export type VectorChunkMetadata = Record<string, unknown> & {
  /** 原始文档来源标识 */
  sourceId?: string;
  /** 块在文档中的序号 */
  chunkIndex?: number;
  /** 块文本 */
  text: string;
};

/** 存储的向量块 */
export type VectorChunk = {
  /** 唯一 ID（UUID） */
  id: string;
  /** 嵌入向量 */
  vector: number[];
  /** 元数据 */
  metadata: VectorChunkMetadata;
};

/** 检索选项 */
export type SearchOptions = {
  /** 返回 topK 结果（默认 5） */
  topK?: number;
  /** 相似度阈值（0-1，低于此值的结果不返回） */
  minScore?: number;
  /** 按 sourceId 过滤 */
  sourceId?: string;
};

/** 检索结果 */
export type ScoredChunk = {
  chunk: VectorChunk;
  score: number; // 0-1, 1=最相似
};

/** 存储统计 */
export type StoreStats = {
  /** 总块数 */
  totalChunks: number;
  /** 独立文档数 */
  totalDocuments: number;
  /** 当前提供者 */
  provider: string;
  /** 嵌入维度 */
  dimensions: number;
};

/** Vector Store 接口 */
export interface VectorStore {
  /** 初始化（连接、建表等） */
  initialize(): Promise<void>;
  /** 写入/更新向量块 */
  upsert(chunks: VectorChunk[]): Promise<void>;
  /** 批量写入（含自动分片） */
  upsertBatch(chunks: VectorChunk[], batchSize?: number): Promise<void>;
  /** 向量检索 */
  search(vector: number[], options?: SearchOptions): Promise<ScoredChunk[]>;
  /** 按 sourceId 删除 */
  deleteBySource(sourceId: string): Promise<void>;
  /** 清空所有数据 */
  clear(): Promise<void>;
  /** 统计信息 */
  stats(): Promise<StoreStats>;
}

// ===================================================================
// 配置相关类型
// ===================================================================

/** Embedding 配置 */
export type KnowledgeEmbeddingConfig = {
  /** API 提供商（默认复用 LLM 配置） */
  provider?: string;
  /** API Base URL */
  baseUrl?: string;
  /** API Key */
  apiKey?: string;
  /** 模型名称 */
  model?: string;
  /** 嵌入维度（仅某些 provider 需要） */
  dimensions?: number;
};

/** 向量存储配置 */
export type KnowledgeStoreConfig = {
  /** 存储提供者 */
  provider: 'zvec' | 'sqlite-vec' | 'redis' | 'pinecone' | 'chroma' | 'weaviate' | 'qdrant' | 'milvus' | 'pgvector' | 'elasticsearch' | 'opensearch' | string;
  /** 命名空间隔离前缀（自动生成，一般不需要手写） */
  namespace?: string;

  // --- 通用连接参数 ---
  /** URL 连接地址 */
  url?: string;
  /** 主机 */
  host?: string;
  /** 端口 */
  port?: number;

  // --- Redis ---
  /** Redis URI */
  redisUri?: string;

  // --- Pinecone ---
  pineconeApiKey?: string;
  pineconeEnvironment?: string;
  pineconeIndexName?: string;

  // --- Chroma ---
  chromaCollectionName?: string;

  // --- Weaviate ---
  weaviateCollectionName?: string;

  // --- PostgreSQL pgvector ---
  pgvectorIndexType?: 'ivfflat' | 'hnsw';
  pgvectorDistanceType?: 'cosine' | 'l2' | 'inner_product';
  pgvectorDimensions?: number;

  // --- Qdrant ---
  qdrantCollectionName?: string;

  // --- Milvus ---
  milvusCollectionName?: string;

  // --- Elasticsearch/OpenSearch ---
  esIndexName?: string;

  // --- ZVec / SQLite-Vec ---
  /** ZVec/SQLite-Vec 的数据库文件路径 */
  dbPath?: string;

  // --- 进阶参数 ---
  /** 索引关联的 source 来源配置（可选） */
  sources?: KnowledgeSourceConfig;

  /** 额外的连接参数（provider 特化） */
  extra?: Record<string, unknown>;
};

/** 来源配置 */
export type KnowledgeSourceConfig = {
  /** 文档来源 IDs */
  docIds?: string[];
  /** 文档目录（本地文件索引） */
  docDirs?: string[];
  /** 外部文档 URL 列表 */
  urls?: string[];
};

/** 检索配置 */
export type KnowledgeRetrievalConfig = {
  /** 检索策略：混合 | 仅向量 | 仅关键词 */
  strategy?: 'hybrid' | 'vector' | 'keyword';
  /** 返回 topK */
  topK?: number;
  /** 相似度阈值 */
  minScore?: number;
  /** 是否启用关键词增强 */
  keywordBoost?: boolean;
};

/** 注入配置 */
export type KnowledgeInjectionConfig = {
  /** 注入位置（默认 system） */
  position?: 'system' | 'user';
  /** 上下文格式模板 */
  template?: string;
  /** 最大上下文块数 */
  maxChunks?: number;
  /** 最大上下文 token 数 */
  maxTokens?: number;
};

/** 过滤配置 */
export type KnowledgeModerationConfig = {
  /** 是否启用内容审核 */
  enabled?: boolean;
  /** 驳回提示词 */
  rejectionMessage?: string;
};

/** 完整知识库配置 */
export type KnowledgeConfig = {
  /** 是否启用 */
  enabled: boolean;
  /** Embedding 配置 */
  embedding?: KnowledgeEmbeddingConfig;
  /** 向量存储配置 */
  store?: KnowledgeStoreConfig;
  /** 检索配置 */
  retrieval?: KnowledgeRetrievalConfig;
  /** 注入配置 */
  injection?: KnowledgeInjectionConfig;
  /** 过滤配置 */
  moderation?: KnowledgeModerationConfig;
};

/** DeepPartial — 递归可选，用于 account 级覆盖（排除 enabled 字段） */
export type DeepPartialKnowledgeConfig = {
  embedding?: DeepPartial<KnowledgeEmbeddingConfig>;
  store?: DeepPartial<KnowledgeStoreConfig> & { sources?: KnowledgeSourceConfig };
  retrieval?: DeepPartial<KnowledgeRetrievalConfig>;
  injection?: DeepPartial<KnowledgeInjectionConfig>;
  moderation?: DeepPartial<KnowledgeModerationConfig>;
};

// ===================================================================
// 内部辅助类型
// ===================================================================

type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

// ===================================================================
// Chunker 相关
// ===================================================================

/** 文本块 */
export type TextChunk = {
  /** 块文本 */
  text: string;
  /** 块在文档中的序号 */
  index: number;
  /** 原始文档 ID */
  sourceId: string;
  /** 字符偏移起始 */
  startOffset: number;
  /** 字符偏移结束 */
  endOffset: number;
};

// ===================================================================
// RAG 上下文结果
// ===================================================================

/** RAG 检索结果（已注入上下文的格式） */
export type RagContextResult = {
  /** 检索到的块列表 */
  chunks: ScoredChunk[];
  /** 格式化的上下文文本 */
  contextText: string;
  /** 注入位置 */
  position: 'system' | 'user';
};

// ===================================================================
// Hook 事件相关
// ===================================================================

/** before_prompt_build 事件的上下文（按 openclaw 规范） */
export type BeforePromptBuildContext = {
  channelId: string;
  agentId?: string;
  userId?: string;
  accountId?: string;
  message?: string;
  [key: string]: unknown;
};

/** before_prompt_build 事件的返回值 */
export type BeforePromptBuildResult = {
  systemPrompt?: string;
  userPrompt?: string;
};
