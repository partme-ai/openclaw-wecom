/**
 * Knowledge 模块公共导出
 *
 * 注意：不重导出不期望外部使用的内部实现（如 retriever/hybrid），
 * 避免命名冲突和意外使用。hooks.ts 提供主要的集成入口。
 */
export type {
  KnowledgeConfig,
  DeepPartialKnowledgeConfig,
  KnowledgeEmbeddingConfig,
  KnowledgeStoreConfig,
  KnowledgeRetrievalConfig,
  KnowledgeInjectionConfig,
  KnowledgeModerationConfig,
  EmbeddingService,
  VectorStore,
  VectorChunk,
  ScoredChunk,
  StoreStats,
  TextChunk,
  RagContextResult,
} from './types.js';

export { OpenAIEmbeddingService } from './embedding/openai.js';
export { createVectorStore, getDefaultStoreConfig } from './store/factory.js';
export { ZVecStore } from './store/zvec.js';
export { hybridSearch } from './retriever/hybrid.js';
export { chunkText } from './indexer/chunker.js';
export { indexDocument, indexDocuments, retrieveContext } from './indexer/scheduler.js';
export { registerKnowledgeHooks, deepMergeKnowledgeConfig, extractKnowledgeConfig } from './hooks.js';
