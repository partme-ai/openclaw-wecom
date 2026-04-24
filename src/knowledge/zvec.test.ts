/**
 * ZVec 存储后端测试
 */
import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../store/math.js';
import { ZVecStore } from '../store/zvec.js';
import type { VectorChunk } from '../types.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('returns 0.5 for orthogonal vectors normalized', () => {
    // [1,0] vs [0,1]: dot=0, magnitude=1*1=1, (0/1+1)/2=0.5
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0.5);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow();
  });
});

describe('ZVecStore', () => {
  function makeStore(): ZVecStore {
    return new ZVecStore({ namespace: 'test', dimensions: 3 });
  }

  function makeChunk(id: string, vector: number[], text: string, sourceId?: string): VectorChunk {
    return { id, vector, metadata: { text, sourceId: sourceId ?? 'doc1', chunkIndex: 0 } };
  }

  it('initializes and reports empty stats', async () => {
    const store = makeStore();
    await store.initialize();
    const stats = await store.stats();
    expect(stats.totalChunks).toBe(0);
    expect(stats.totalDocuments).toBe(0);
  });

  it('stores and retrieves chunks', async () => {
    const store = makeStore();
    await store.initialize();

    const chunk = makeChunk('c1', [1, 0, 0], 'hello world');
    await store.upsert([chunk]);

    const results = await store.search([1, 0, 0], { topK: 5 });
    expect(results.length).toBe(1);
    expect(results[0].chunk.metadata.text).toBe('hello world');
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it('filters by sourceId', async () => {
    const store = makeStore();
    await store.initialize();

    await store.upsert([
      makeChunk('c1', [1, 0, 0], 'doc1 text', 'src1'),
      makeChunk('c2', [0, 1, 0], 'doc2 text', 'src2'),
    ]);

    const results = await store.search([1, 0, 0], { topK: 5, sourceId: 'src1' });
    expect(results.length).toBe(1);
    expect(results[0].chunk.metadata.sourceId).toBe('src1');
  });

  it('deletes by sourceId', async () => {
    const store = makeStore();
    await store.initialize();

    await store.upsert([
      makeChunk('c1', [1, 0, 0], 'text', 'src1'),
      makeChunk('c2', [0, 1, 0], 'text', 'src2'),
    ]);

    await store.deleteBySource('src1');
    const stats = await store.stats();
    expect(stats.totalChunks).toBe(1);
  });

  it('clears all data', async () => {
    const store = makeStore();
    await store.initialize();
    await store.upsert([makeChunk('c1', [1, 0, 0], 'text')]);
    await store.clear();
    const stats = await store.stats();
    expect(stats.totalChunks).toBe(0);
  });
});
