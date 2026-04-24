/**
 * SQLite-Vec 存储后端 — 生产推荐方案
 *
 * 基于 better-sqlite3 的 SQLite 向量扩展，数据持久化到本地文件。
 * 特点：
 * - 原生 SQLite 支持，无需外部数据库服务
 * - 支持余弦相似度检索（通过自定义函数）
 * - 按命名空间分表隔离
 * - 持久化到文件（重启不丢失）
 *
 * 安装依赖：
 *   npm install better-sqlite3 @types/better-sqlite3
 *
 * 注意：这是一个可选后端，使用前需要安装 better-sqlite3 依赖。
 * 如果未安装，initialize() 会抛出错误提示。
 */

import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { VectorStore, VectorChunk, VectorChunkMetadata, SearchOptions, ScoredChunk, StoreStats } from '../types.js';
import { cosineSimilarity } from './math.js';

/** SQLite-Vec 配置 */
export type SqliteVecConfig = {
  /** 数据库文件路径 */
  dbPath: string;
  /** 命名空间（用于多租户隔离） */
  namespace: string;
  /** 嵌入维度 */
  dimensions: number;
};

/** 内部表结构行 */
type ChunkRow = {
  id: string;
  source_id: string;
  chunk_index: number;
  text: string;
  metadata_json: string;
};

export class SqliteVecStore implements VectorStore {
  private config: SqliteVecConfig;
  private db: import('better-sqlite3').Database | null = null;
  private namespaceTable: string;

  constructor(config: SqliteVecConfig) {
    this.config = config;
    // 命名空间作为表名一部分，自动转义防止注入
    this.namespaceTable = `vec_${this.sanitizeName(config.namespace)}`;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.config.dbPath), { recursive: true });

    let Database: typeof import('better-sqlite3').default;
    try {
      Database = (await import('better-sqlite3')).default;
    } catch {
      throw new Error(
        'better-sqlite3 is not installed. To use SqliteVecStore, run: npm install better-sqlite3 @types/better-sqlite3\n' +
        'Alternatively, use ZVecStore (in-memory + JSON fallback) for development.'
      );
    }

    this.db = new Database(this.config.dbPath);

    // 启用 WAL 模式提升并发性能
    this.db.pragma('journal_mode = WAL');
    // 启用外键
    this.db.pragma('foreign_keys = ON');

    // 创建向量表（每行一个 chunk，向量存为 BLOB）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.namespaceTable} (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL DEFAULT '',
        chunk_index INTEGER NOT NULL DEFAULT 0,
        vector BLOB NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 创建 source_id 索引以加速按来源删除
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.namespaceTable}_source_id
      ON ${this.namespaceTable}(source_id);
    `);
  }

  async upsert(chunks: VectorChunk[]): Promise<void> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.namespaceTable} (id, source_id, chunk_index, vector, text, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: VectorChunk[]) => {
      for (const chunk of items) {
        stmt.run(
          chunk.id,
          chunk.metadata.sourceId ?? '',
          chunk.metadata.chunkIndex ?? 0,
          Buffer.from(new Float32Array(chunk.vector).buffer),
          chunk.metadata.text,
          JSON.stringify(chunk.metadata),
        );
      }
    });

    insertMany(chunks);
  }

  async upsertBatch(chunks: VectorChunk[], batchSize = 100): Promise<void> {
    // SQLite transaction 已包含批量语义
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      await this.upsert(batch);
    }
  }

  async search(vector: number[], options?: SearchOptions): Promise<ScoredChunk[]> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');

    const topK = options?.topK ?? 5;
    const minScore = options?.minScore ?? 0.0;

    // 一次性查询所有字段（包括 vector BLOB），避免 N+1 问题
    let rows: (ChunkRow & { vector: Buffer })[];
    if (options?.sourceId) {
      rows = this.db.prepare(
        `SELECT id, source_id, chunk_index, vector, text, metadata_json FROM ${this.namespaceTable} WHERE source_id = ?`
      ).all(options.sourceId) as (ChunkRow & { vector: Buffer })[];
    } else {
      rows = this.db.prepare(
        `SELECT id, source_id, chunk_index, vector, text, metadata_json FROM ${this.namespaceTable}`
      ).all() as (ChunkRow & { vector: Buffer })[];
    }

    // 逐行计算余弦相似度（全表扫描，适合中小规模）
    // 大规模场景（>10万行）建议用 SQLite-Vec 的 vector 函数或换专业向量数据库
    const scored: ScoredChunk[] = rows.map((row) => {
      const metadata = JSON.parse(row.metadata_json) as VectorChunkMetadata;

      // 从 BLOB 还原向量
      const storedVector = Array.from(new Float32Array(row.vector.buffer));

      const score = cosineSimilarity(vector, storedVector);

      return {
        chunk: {
          id: row.id,
          vector: storedVector,
          metadata: {
            ...metadata,
            sourceId: row.source_id,
            chunkIndex: row.chunk_index,
            text: row.text,
          },
        },
        score,
      };
    });

    // 阈值过滤 + 排序 + topK
    return scored
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async deleteBySource(sourceId: string): Promise<void> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');
    this.db.prepare(`DELETE FROM ${this.namespaceTable} WHERE source_id = ?`).run(sourceId);
  }

  async clear(): Promise<void> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');
    this.db.exec(`DELETE FROM ${this.namespaceTable}`);
  }

  stats(): Promise<StoreStats> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');

    const { count: totalChunks } = this.db.prepare(
      `SELECT COUNT(*) as count FROM ${this.namespaceTable}`
    ).get() as { count: number };

    const { count: totalDocuments } = this.db.prepare(
      `SELECT COUNT(DISTINCT source_id) as count FROM ${this.namespaceTable} WHERE source_id != ''`
    ).get() as { count: number };

    return Promise.resolve({
      totalChunks,
      totalDocuments,
      provider: 'sqlite-vec',
      dimensions: this.config.dimensions,
    });
  }

  /** 生成 chunk ID */
  static generateId(namespace: string, sourceId: string, chunkIndex: number): string {
    return `${namespace}:${sourceId}:${chunkIndex}:${randomUUID().slice(0, 8)}`;
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /** 清理命名空间名（仅允许字母数字下划线） */
  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  }
}
