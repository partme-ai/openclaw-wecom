/**
 * 知识库配置深度合并测试
 */
import { describe, it, expect } from 'vitest';
import { deepMergeKnowledgeConfig } from './hooks.js';
import type { KnowledgeConfig, DeepPartialKnowledgeConfig } from './types.js';

const baseGlobal: KnowledgeConfig = {
  enabled: true,
  embedding: { model: 'text-embedding-ada-002', dimensions: 1536 },
  store: { provider: 'zvec', dbPath: './data/default.json' },
  retrieval: { strategy: 'hybrid', topK: 5, minScore: 0.3 },
  injection: { position: 'system' },
};

describe('deepMergeKnowledgeConfig', () => {
  it('returns null when global is not enabled', () => {
    expect(deepMergeKnowledgeConfig({ enabled: false })).toBeNull();
  });

  it('returns global config when no override', () => {
    const result = deepMergeKnowledgeConfig(baseGlobal);
    expect(result).not.toBeNull();
    expect(result!.store!.provider).toBe('zvec');
    expect(result!.retrieval!.topK).toBe(5);
  });

  it('merges embedding override', () => {
    const override: DeepPartialKnowledgeConfig = {
      embedding: { model: 'text-embedding-3-small', dimensions: 768 },
    };
    const result = deepMergeKnowledgeConfig(baseGlobal, override);
    expect(result!.embedding!.model).toBe('text-embedding-3-small');
    expect(result!.embedding!.dimensions).toBe(768);
  });

  it('deep merges retrieval, keeps unspecified fields', () => {
    const override: DeepPartialKnowledgeConfig = {
      retrieval: { topK: 10 },
    };
    const result = deepMergeKnowledgeConfig(baseGlobal, override);
    expect(result!.retrieval!.topK).toBe(10);
    expect(result!.retrieval!.strategy).toBe('hybrid'); // 来自 global
    expect(result!.retrieval!.minScore).toBe(0.3); // 来自 global
  });

  it('replaces store.sources entirely, does not merge', () => {
    const globalWithSources: KnowledgeConfig = {
      ...baseGlobal,
      store: { ...baseGlobal.store!, sources: { docIds: ['doc1'] } },
    };
    const override: DeepPartialKnowledgeConfig = {
      store: { sources: { docIds: ['doc2'] } },
    };
    const result = deepMergeKnowledgeConfig(globalWithSources, override);
    expect(result!.store!.sources!.docIds).toEqual(['doc2']);
    expect(result!.store!.sources!.docIds).not.toContain('doc1');
  });
});
