/**
 * 混合检索器 — 向量检索 + 简易关键词增强
 *
 * 策略说明：
 * - vector: 纯向量检索
 * - keyword: 纯关键词 BM25 近似（基于词频匹配）
 * - hybrid: 向量 + 关键词加权融合（默认权重 0.7:0.3）
 */

import type { EmbeddingService, VectorStore, SearchOptions, ScoredChunk } from '../types.js';

/** 混合检索配置 */
export type HybridRetrievalConfig = {
  /** 检索策略 */
  strategy: 'hybrid' | 'vector' | 'keyword';
  /** 向量权重（0-1，仅在 hybrid 模式下生效） */
  vectorWeight: number;
  /** 关键词权重（0-1，仅在 hybrid 模式下生效） */
  keywordWeight: number;
  /** BM25 参数 k1 */
  k1: number;
  /** BM25 参数 b */
  b: number;
};

const DEFAULT_CONFIG: HybridRetrievalConfig = {
  strategy: 'hybrid',
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  k1: 1.5,
  b: 0.75,
};

/**
 * 混合检索
 */
export async function hybridSearch(
  query: string,
  embedding: EmbeddingService,
  store: VectorStore,
  options?: SearchOptions & { config?: Partial<HybridRetrievalConfig> },
): Promise<ScoredChunk[]> {
  const config = { ...DEFAULT_CONFIG, ...options?.config };
  const topK = options?.topK ?? 5;

  switch (config.strategy) {
    case 'vector': {
      const vector = await embedding.embed(query);
      return store.search(vector, options);
    }

    case 'keyword': {
      return keywordSearch(query, store, topK, options?.sourceId);
    }

    case 'hybrid': {
      console.log('[Knowledge] hybrid search...');
      const vector = await embedding.embed(query);
      const [vectorResults, keywordResults] = await Promise.all([
        store.search(vector, { ...options, topK: topK * 2 }),
        keywordSearch(query, store, topK * 2, options?.sourceId),
      ]);

      return fuseResults(
        vectorResults,
        keywordResults,
        config.vectorWeight,
        config.keywordWeight,
        topK,
      );
    }

    default:
      throw new Error(`Unknown retrieval strategy: ${config.strategy}`);
  }
}

/**
 * 简易关键词检索（基于词频 + TF 近似）
 * 不依赖外部索引，直接从 VectorStore 的 metadata.text 中匹配关键词
 */
async function keywordSearch(
  query: string,
  store: VectorStore,
  topK: number,
  sourceId?: string,
): Promise<ScoredChunk[]> {
  // 获取所有 chunks
  const allChunks = await getAllChunks(store, sourceId);
  if (allChunks.length === 0) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const scored: ScoredChunk[] = allChunks.map((chunk) => {
    const docTerms = tokenize(chunk.metadata.text);
    const docLen = docTerms.length;
    if (docLen === 0) return { chunk, score: 0 };

    // 简单词频统计
    let matched = 0;
    for (const term of queryTerms) {
      if (docTerms.includes(term)) matched++;
    }

    // TF 近似：匹配词数 / 查询词数
    const score = matched / queryTerms.length;
    return { chunk, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * 融合向量结果和关键词结果
 */
function fuseResults(
  vectorResults: ScoredChunk[],
  keywordResults: ScoredChunk[],
  vectorWeight: number,
  keywordWeight: number,
  topK: number,
): ScoredChunk[] {
  const scores = new Map<string, { chunk: ScoredChunk['chunk']; score: number }>();

  // 加入向量结果
  for (const item of vectorResults) {
    scores.set(item.chunk.id, {
      chunk: item.chunk,
      score: item.score * vectorWeight,
    });
  }

  // 融合关键词结果
  for (const item of keywordResults) {
    const existing = scores.get(item.chunk.id);
    if (existing) {
      existing.score += item.score * keywordWeight;
    } else {
      scores.set(item.chunk.id, {
        chunk: item.chunk,
        score: item.score * keywordWeight,
      });
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk, score }) => ({ chunk, score }));
}

/**
 * 从 store 获取所有 chunks（通过搜索零向量近似来实现全量获取）
 * 注意：这是一个近似方法，仅适用于小型数据集
 */
async function getAllChunks(store: VectorStore, sourceId?: string): Promise<ScoredChunk['chunk'][]> {
  // 我们构造一个近似全量查询：用小维度的随机向量搜索大量结果
  // 实际生产环境应该有更好的分页方法，但第一版够用
  const dummyVector = new Array(384).fill(0);
  const results = await store.search(dummyVector, {
    topK: 10000,
    minScore: 0,
    sourceId,
  });
  return results.map((r) => r.chunk);
}

/**
 * 简易中文分词（按字符 + 英文按空格）
 */
function tokenize(text: string): string[] {
  // 先按非字母数字字符切分英文单词
  const words: string[] = [];

  // 提取英文单词
  const englishWords = text.match(/[a-zA-Z0-9]+/g) || [];
  words.push(...englishWords.map((w) => w.toLowerCase()));

  // 提取中文字符（单字）
  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || [];
  // 简单二元组
  for (let i = 0; i < chineseChars.length; i++) {
    words.push(chineseChars[i]);
    if (i + 1 < chineseChars.length) {
      words.push(chineseChars[i] + chineseChars[i + 1]);
    }
  }

  return [...new Set(words)];
}
