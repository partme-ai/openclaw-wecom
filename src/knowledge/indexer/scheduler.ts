/**
 * 文档索引调度器
 *
 * 负责：
 * 1. 从文档来源（本地文件/企微文档）读取原始文本
 * 2. 调用 chunker 切分
 * 3. 调用 embedding 生成向量
 * 4. 存入 VectorStore
 *
 * 第一版支持：本地文件索引（传入文件路径列表）
 * 后续支持：企微文档库 API 轮询、Webhook 增量更新
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { EmbeddingService, VectorStore, TextChunk, ScoredChunk } from '../types.js';
import { chunkText } from './chunker.js';
import type { ChunkerConfig } from './chunker.js';

/** 文档索引结果 */
export type IndexResult = {
  /** 新增的块数 */
  chunksAdded: number;
  /** 处理的文档 ID */
  sourceId: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
};

/** 文档加载器 — 从文件路径读取文本 */
export async function loadDocument(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  // 目前仅支持纯文本文件
  // 后续可扩展：.md、.txt、.csv、.json、.pdf（需额外依赖）
  if (ext === '.md' || ext === '.txt' || ext === '.csv' || ext === '.json') {
    return await readFile(filePath, 'utf-8');
  }

  throw new Error(`Unsupported file type: ${ext} (supported: .md, .txt, .csv, .json)`);
}

/**
 * 索引单个文档
 */
export async function indexDocument(
  filePath: string,
  sourceId: string,
  embedding: EmbeddingService,
  store: VectorStore,
  chunkerConfig?: Partial<ChunkerConfig>,
): Promise<IndexResult> {
  try {
    const text = await loadDocument(filePath);
    const chunks = chunkText(text, sourceId, chunkerConfig);

    if (chunks.length === 0) {
      return { chunksAdded: 0, sourceId, success: true };
    }

    // 批量生成嵌入
    const texts = chunks.map((c) => c.text);
    const vectors = await embedding.embedBatch(texts);

    // 组合为 VectorChunk
    const vectorChunks = chunks.map((chunk, i) => ({
      id: `doc:${sourceId}:${chunk.index}`,
      vector: vectors[i],
      metadata: {
        sourceId: chunk.sourceId,
        chunkIndex: chunk.index,
        text: chunk.text,
        filePath,
      },
    }));

    // 先删除旧数据再写入
    await store.deleteBySource(sourceId);
    await store.upsert(vectorChunks);

    return {
      chunksAdded: vectorChunks.length,
      sourceId,
      success: true,
    };
  } catch (error) {
    return {
      chunksAdded: 0,
      sourceId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 批量索引多个文档
 */
export async function indexDocuments(
  sources: { filePath: string; sourceId: string }[],
  embedding: EmbeddingService,
  store: VectorStore,
  chunkerConfig?: Partial<ChunkerConfig>,
): Promise<IndexResult[]> {
  const results: IndexResult[] = [];

  for (const { filePath, sourceId } of sources) {
    const result = await indexDocument(filePath, sourceId, embedding, store, chunkerConfig);
    results.push(result);
  }

  return results;
}

/**
 * 从 VectorStore 检索上下文 - 供 before_prompt_build hook 使用
 */
export async function retrieveContext(
  query: string,
  embedding: EmbeddingService,
  store: VectorStore,
  topK: number = 5,
  minScore: number = 0.0,
  sourceId?: string,
): Promise<{ chunks: ScoredChunk[]; contextText: string }> {
  const vector = await embedding.embed(query);
  const chunks = await store.search(vector, { topK, minScore, sourceId });

  const contextText = chunks
    .map((scored, i) => `[${i + 1}] (相似度: ${(scored.score * 100).toFixed(1)}%)\n${scored.chunk.metadata.text}`)
    .join('\n\n---\n\n');

  return { chunks, contextText };
}
