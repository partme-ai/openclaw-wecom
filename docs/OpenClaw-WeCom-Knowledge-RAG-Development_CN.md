# OpenClaw-WeCom 知识库 RAG 开发者指南

> 本指南面向希望在 `openclaw-wecom` 知识库 RAG 模块上进行功能扩展、添加新向量存储后端或定制检索策略的开发者。

---

**前置阅读**：
- [OpenClaw-WeCom-Knowledge-RAG-Architecture_CN.md](./OpenClaw-WeCom-Knowledge-RAG-Architecture_CN.md) — 架构与模块设计

---

## 目录

1. 本地开发环境搭建
2. 代码结构与核心类型
3. 扩展 Embedding 服务
4. 添加新的向量存储后端
5. 自定义文本切分策略
6. 定制检索策略
7. 测试指南
8. 开发规范与约定

---

## 1. 本地开发环境搭建

### 1.1 克隆与安装

```bash
git clone https://github.com/your-org/openclaw-wecom
cd openclaw-wecom

# 确认 Node.js 版本 ≥ 18
node -v

# 安装依赖
npm install

# 可选：SQLite-Vec 依赖（需要原生模块编译）
npm install better-sqlite3
```

### 1.2 类型检查

```bash
npx tsc --noEmit
```

### 1.3 运行测试

```bash
# 运行所有测试
npx vitest --config vitest.config.ts

# 仅运行知识库模块相关测试
npx vitest --config vitest.config.ts src/knowledge/

# 运行特定测试
npx vitest --config vitest.config.ts src/knowledge/zvec.test.ts
npx vitest --config vitest.config.ts src/knowledge/chunker.test.ts
npx vitest --config vitest.config.ts src/knowledge/config-merge.test.ts
```

### 1.4 调试输出

知识库模块的所有日志均以 `[KNOWLEDGE]` 前缀输出：

```typescript
// 在 hooks.ts 和 scheduler.ts 中使用
logger.info('[KNOWLEDGE] 索引文档: ' + filePath);
logger.warn('[KNOWLEDGE] 检索无结果: ' + query);
logger.error('[KNOWLEDGE] Embedding API 连接失败: ' + error);
```

---

## 2. 代码结构与核心类型

### 2.1 核心模块文件清单

```
src/knowledge/
├── types.ts                      ← 所有核心类型的单一源
├── hooks.ts                      ← 插件生命周期 + before_prompt_build hook
├── index.ts                      ← 公共导出
│
├── embedding/
│   ├── openai.ts                 ← OpenAI 兼容 Embedding 实现
│   └── [custom].ts               ← 你的自定义 Embedding 服务
│
├── store/
│   ├── factory.ts                ← VectorStore 工厂（创建/配置）
│   ├── zvec.ts                   ← 纯 JS 内存向量引擎
│   ├── sqlite-vec.ts             ← SQLite 持久化向量引擎
│   ├── math.ts                   ← 余弦相似度等数学工具
│   └── [custom].ts               ← 你的自定义 VectorStore
│
├── indexer/
│   ├── chunker.ts                ← 文本切分器
│   ├── scheduler.ts              ← 索引调度器
│   └── [custom-chunker].ts       ← 你的自定义切分策略
│
└── retriever/
    ├── hybrid.ts                 ← 混合检索
    └── [custom].ts               ← 你的自定义检索器
```

### 2.2 核心类型树

```typescript
// === Embedding 接口 ===
export interface EmbeddingService {
  readonly dimensions: number;
  readonly modelName: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  health(): Promise<boolean>;
}

// === VectorStore 接口 ===
export interface VectorStore {
  initialize(): Promise<void>;
  upsert(chunks: VectorChunk[]): Promise<void>;
  upsertBatch(chunks: VectorChunk[], batchSize?: number): Promise<void>;
  search(vector: number[], options?: SearchOptions): Promise<ScoredChunk[]>;
  deleteBySource(sourceId: string): Promise<void>;
  clear(): Promise<void>;
  stats(): Promise<StoreStats>;
}

// === 数据模型 ===
export type VectorChunk = {
  id: string;
  vector: number[];
  metadata: VectorChunkMetadata;
};

export type ScoredChunk = {
  chunk: VectorChunk;
  score: number;
};

export type SearchOptions = {
  topK?: number;
  minScore?: number;
  sourceId?: string;
};
```

### 2.3 核心入口点（hooks.ts 调用链路）

```
插件注册（register）
  └─ registerKnowledgeHooks(api)
       ├─ 存储 api 引用
       ├─ 注册 before_prompt_build hook → handleBeforePromptBuild
       └─ 注册 onUnload 清理 → storeCache 清除

before_prompt_build 事件
  └─ handleBeforePromptBuild(ctx)
       ├─ 跳过非 wecom 通道
       ├─ 解析配置（全局 + account 覆盖）
       ├─ getOrCreateStore(config, namespace)
       └─ retrieveContext(query, embedding, store, topK)
            └─ 返回 { systemPrompt: contextText }
```

---

## 3. 扩展 Embedding 服务

### 3.1 实现 EmbeddingService 接口

所有 Embedding 服务必须实现 `EmbeddingService` 接口。以自定义 `HuggingFaceEmbedding` 为例：

```typescript
// src/knowledge/embedding/huggingface.ts
import type { EmbeddingService, KnowledgeEmbeddingConfig } from '../types.js';

export class HuggingFaceEmbeddingService implements EmbeddingService {
  readonly dimensions: number;
  readonly modelName: string;
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: KnowledgeEmbeddingConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api-inference.huggingface.co';
    this.apiKey = config.apiKey;
    this.modelName = config.model ?? 'sentence-transformers/all-MiniLM-L6-v2';
    // HuggingFace 模型的默认维度
    this.dimensions = config.dimensions ?? 384;
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/pipeline/feature-extraction/${this.modelName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
    });

    if (!response.ok) {
      throw new Error(`HuggingFace embedding API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result as number[][];
  }

  async health(): Promise<boolean> {
    try {
      await this.embed('health check');
      return true;
    } catch {
      return false;
    }
  }
}
```

### 3.2 注册到 Embedding 工厂

```typescript
// 在 hooks.ts 或 factory.ts 中：
function createEmbeddingService(config: KnowledgeEmbeddingConfig): EmbeddingService {
  const provider = config.provider ?? 'openai';

  switch (provider) {
    case 'openai':
      return new OpenAIEmbeddingService(config);
    case 'huggingface':
      return new HuggingFaceEmbeddingService(config);
    default:
      throw new Error(`不支持的 Embedding provider: ${provider}`);
  }
}
```

---

## 4. 添加新的向量存储后端

### 4.1 实现 VectorStore 接口

以自定义 `MemoryStore` 为例：

```typescript
// src/knowledge/store/memory.ts
import type { VectorStore, VectorChunk, ScoredChunk, SearchOptions, StoreStats } from '../types.js';
import { cosineSimilarity } from './math.js';

export class MemoryStore implements VectorStore {
  private chunks: VectorChunk[] = [];
  private dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  async initialize(): Promise<void> {
    this.chunks = [];
  }

  async upsert(chunks: VectorChunk[]): Promise<void> {
    for (const chunk of chunks) {
      const idx = this.chunks.findIndex(c => c.id === chunk.id);
      if (idx >= 0) {
        this.chunks[idx] = chunk;
      } else {
        this.chunks.push(chunk);
      }
    }
  }

  async upsertBatch(chunks: VectorChunk[], batchSize = 100): Promise<void> {
    // 分片处理（大批量时避免内存抖动）
    for (let i = 0; i < chunks.length; i += batchSize) {
      await this.upsert(chunks.slice(i, i + batchSize));
    }
  }

  async search(vector: number[], options?: SearchOptions): Promise<ScoredChunk[]> {
    const { topK = 5, minScore = 0, sourceId } = options ?? {};

    const scored = this.chunks
      .filter(c => !sourceId || c.metadata.sourceId === sourceId)
      .map(chunk => ({
        chunk,
        score: cosineSimilarity(vector, chunk.vector),
      }))
      .filter(s => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  async deleteBySource(sourceId: string): Promise<void> {
    this.chunks = this.chunks.filter(c => c.metadata.sourceId !== sourceId);
  }

  async clear(): Promise<void> {
    this.chunks = [];
  }

  async stats(): Promise<StoreStats> {
    const sources = new Set(this.chunks.map(c => c.metadata.sourceId ?? ''));
    return {
      totalChunks: this.chunks.length,
      totalDocuments: sources.size,
      provider: 'memory',
      dimensions: this.dimensions,
    };
  }
}
```

### 4.2 注册到 Store 工厂

在 `src/knowledge/store/factory.ts` 中添加新分支：

```typescript
export async function createVectorStore(
  config: KnowledgeStoreConfig,
  dimensions: number,
): Promise<VectorStore> {
  switch (config.provider) {
    case 'zvec':
      return new ZVecStore(dimensions);
    case 'sqlite-vec':
      return new SqliteVecStore(config.dbPath!, dimensions);
    case 'memory':
      return new MemoryStore(dimensions);
    // ... 其他后端
    default:
      throw new Error(`不支持的向量存储提供者: ${config.provider}`);
  }
}
```

### 4.3 后端实现的注意事项

| 关注点 | 说明 |
|--------|------|
| **线程安全** | SQLite-Vec 等后端需使用 WAL 模式处理并发写入 |
| **批量写入** | 实现 `upsertBatch` 时考虑分片策略（默认每批 100 条） |
| **维度校验** | 写入前校验 `vector.length === dimensions`，不匹配时抛错 |
| **返回格式** | `search` 返回的 `score` 必须是 0-1 之间的数值，1 表示最相似 |
| **命名空间** | 工厂根据 `namespace` 创建独立的实例（或表/集合） |

---

## 5. 自定义文本切分策略

### 5.1 实现新的 Chunker

```typescript
// src/knowledge/indexer/code-chunker.ts
import type { TextChunk } from '../types.js';

/**
 * 代码文件专用切分器
 * - 按函数/类定义切分（而非行数）
 * - 保留函数签名作为前缀
 */
export function chunkCode(code: string, sourceId: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  // 按函数定义切分（简化示例）
  const funcRegex = /(?:function|async function|const \w+ =|class \w+)[^;{]*{(?:[^{}]*{[^{}]*}[^{}]*)*}/gs;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = funcRegex.exec(code)) !== null) {
    chunks.push({
      text: match[0],
      index,
      sourceId,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
    index++;
  }

  return chunks;
}
```

### 5.2 注册到 Chunker 调度器

```typescript
// 在 scheduler.ts 中或通过策略配置：
const chunkerStrategies: Record<string, (text: string, sourceId: string) => TextChunk[]> = {
  recursive: chunkText,        // 默认递归切分
  fixed: chunkFixed,           // 固定长度
  code: chunkCode,             // 代码专用
  markdown: chunkMarkdown,     // Markdown 标题切分
};
```

---

## 6. 定制检索策略

### 6.1 实现自定义 Retriever

```typescript
// src/knowledge/retriever/rrf.ts — 基于 Reciprocal Rank Fusion 的多路召回融合
import type { EmbeddingService, VectorStore, ScoredChunk, RagContextResult } from '../types.js';

export async function rrfRetrieval(
  query: string,
  embedding: EmbeddingService,
  store: VectorStore,
  options: {
    topK: number;
    minScore: number;
  },
): Promise<RagContextResult> {
  // 1. 向量检索
  const queryVec = await embedding.embed(query);
  const vectorResults = await store.search(queryVec, { topK: options.topK * 2 });

  // 2. 如果有关键词检索能力，再加一路
  // ...

  // 3. RRF 融合（简化版）
  const rrfScores = new Map<string, { chunk: ScoredChunk['chunk']; score: number }>();
  vectorResults.forEach((result, rank) => {
    const rrfScore = 1 / (60 + rank); // RRF 公式
    const existing = rrfScores.get(result.chunk.id);
    rrfScores.set(result.chunk.id, {
      chunk: result.chunk,
      score: (existing?.score ?? 0) + rrfScore,
    });
  });

  const sorted = Array.from(rrfScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, options.topK);

  const contextText = sorted
    .map((s, i) => `[${i + 1}] ${s.chunk.metadata.text}`)
    .join('\n\n---\n\n');

  return {
    chunks: sorted.map(s => ({ chunk: s.chunk, score: s.score })),
    contextText,
    position: 'system',
  };
}
```

### 6.2 注册到检索调度

```typescript
// 在 hooks.ts 的 handleBeforePromptBuild 中：
const retrievalStrategies = {
  vector: vectorRetrieval,
  keyword: keywordRetrieval,
  hybrid: hybridSearch,
  rrf: rrfRetrieval,      // 新增
};
```

---

## 7. 测试指南

### 7.1 测试策略

| 层次 | 测试内容 | 测试文件 |
|------|----------|----------|
| 单元测试 | VectorStore 基本操作（upsert/search/delete） | `zvec.test.ts` |
| 单元测试 | Chunker 切分逻辑 | `chunker.test.ts` |
| 单元测试 | 配置合并逻辑 | `config-merge.test.ts` |
| 集成测试 | Embedding + Store + Chunker 端到端 | `scheduler.test.ts` |
| 集成测试 | Hook 注入完整链路 | `hooks.test.ts` |

### 7.2 模拟 Embedding

为了在测试中避免真实的 API 调用，测试使用固定维度的随机向量：

```typescript
// test-utils/mock-embedding.ts
export class MockEmbeddingService implements EmbeddingService {
  readonly dimensions = 4;
  readonly modelName = 'mock';

  async embed(text: string): Promise<number[]> {
    return [0.1, 0.2, 0.3, 0.4]; // 固定向量，便于断言
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0.1, 0.2, 0.3, 0.4]);
  }

  async health(): Promise<boolean> {
    return true;
  }
}
```

### 7.3 ZVec 测试示例

```typescript
// src/knowledge/zvec.test.ts
import { describe, it, expect } from 'vitest';
import { ZVecStore } from './store/zvec.js';

describe('ZVecStore', () => {
  const store = new ZVecStore(4);

  it('should initialize empty', async () => {
    const stats = await store.stats();
    expect(stats.totalChunks).toBe(0);
  });

  it('should upsert and search', async () => {
    await store.upsert([{
      id: 'test-1',
      vector: [1, 0, 0, 0],
      metadata: { text: 'hello', sourceId: 'doc1' },
    }]);

    const results = await store.search([1, 0, 0, 0], { topK: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].chunk.metadata.text).toBe('hello');
    expect(results[0].score).toBeCloseTo(1, 3);
  });

  it('should delete by source', async () => {
    await store.deleteBySource('doc1');
    const stats = await store.stats();
    expect(stats.totalChunks).toBe(0);
  });
});
```

### 7.4 Chunker 测试示例

```typescript
// src/knowledge/chunker.test.ts
import { describe, it, expect } from 'vitest';
import { chunkText } from './indexer/chunker.js';

describe('chunkText', () => {
  it('should split long text into chunks', () => {
    const text = 'A'.repeat(3000); // 超过 chunkSize 默认 1000
    const chunks = chunkText(text, 'test-doc');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].sourceId).toBe('test-doc');
  });

  it('should preserve text content across chunks with overlap', () => {
    const text = 'Hello World! ' + 'B'.repeat(1000) + ' Goodbye!';
    const chunks = chunkText(text, 'test', { chunkSize: 200, chunkOverlap: 50 });
    // 验证重叠区域
    const overlap = chunks[0].text.slice(-50);
    expect(chunks[1].text.startsWith(overlap)).toBe(true);
  });

  it('should return single chunk for short text', () => {
    const chunks = chunkText('Short text', 'test');
    expect(chunks).toHaveLength(1);
  });

  it('should handle empty text', () => {
    const chunks = chunkText('', 'test');
    expect(chunks).toHaveLength(0);
  });
});
```

### 7.5 配置合并测试示例

```typescript
// src/knowledge/config-merge.test.ts
import { describe, it, expect } from 'vitest';
import { deepMergeKnowledgeConfig } from './hooks.js';

describe('deepMergeKnowledgeConfig', () => {
  it('should merge embedding configs', () => {
    const global = { enabled: true, embedding: { model: 'default-model', dimensions: 1536 } };
    const account = { embedding: { model: 'account-model' } };
    const merged = deepMergeKnowledgeConfig(global, account);
    expect(merged.embedding.model).toBe('account-model');
    expect(merged.embedding.dimensions).toBe(1536); // 继承全局
  });

  it('should completely replace sources in store config', () => {
    const global = { enabled: true, store: { provider: 'zvec', sources: { docIds: ['a', 'b'] } } };
    const account = { store: { sources: { docIds: ['c'] } } };
    const merged = deepMergeKnowledgeConfig(global, account);
    expect(merged.store.sources.docIds).toEqual(['c']); // 完全替换
  });

  it('should keep enabled from global', () => {
    const global = { enabled: true };
    const account = {} as any;
    const merged = deepMergeKnowledgeConfig(global, account);
    expect(merged.enabled).toBe(true);
  });
});
```

---

## 8. 开发规范与约定

### 8.1 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 接口 | `I` 前缀不强制，但接口名需清晰 | `VectorStore`, `EmbeddingService` |
| 实现类 | 以具体的后端/策略命名 | `ZVecStore`, `OpenAIEmbeddingService` |
| 类型 | PascalCase | `KnowledgeConfig`, `ScoredChunk` |
| 函数 | camelCase | `chunkText`, `indexDocument` |
| 文件 | kebab-case | `sqlite-vec.ts`, `config-merge.test.ts` |

### 8.2 错误处理规范

```typescript
// ✅ 正确：外层统一 try/catch，内层抛出具体错误
async function indexDocument(...) {
  const text = await loadDocument(filePath); // 可能抛 Error
  const chunks = chunkText(text, sourceId);  // 纯计算，不抛错
  const vectors = await embedding.embedBatch(texts); // 可能抛 Error
  await store.upsert(vectorChunks); // 可能抛 Error
}

// 调用方统一捕获
try {
  await indexDocument(...);
} catch (error) {
  logger.error('[KNOWLEDGE] 索引失败: ' + error.message);
  // 不重新抛出——知识库失败不影响对话
}
```

### 8.3 日志约定

| 级别 | 使用场景 | 示例 |
|------|----------|------|
| `info` | 索引成功、检索命中 | `[KNOWLEDGE] 索引成功: 12 chunks` |
| `warn` | 配置不完整、检索无结果 | `[KNOWLEDGE] 检索未命中：query="xxx"` |
| `error` | API 失败、存储异常 | `[KNOWLEDGE] Embedding API 连接失败: xxx` |

### 8.4 侵入式修改的规范

知识库 RAG 子模块在 `src/monitor.ts`、`src/agent/handler.ts` 和 `src/knowledge/indexer/scheduler.ts` 中有四处侵入点。修改时必须遵守基本原则（try/catch 包裹、纯加法、日志前缀），本节给出四处侵入点的详细实现方案。

#### 8.4.1 侵入点 1：Agent 模式 — 文件入库索引（通路 A）

> **数据来源说明**：本侵入点属于**通路 A（用户上传文件 → 对话级索引）**。用户发给 Agent 的文件索引到 `accountId:agent` 命名空间，仅影响该用户在当前 Agent 中的私有上下文，**不写入企业级全局知识库**。

**位置**：`src/agent/handler.ts`，`processAgentMessage()` 函数，约第 330–428 行（媒体文件处理块）。

**原始流程**：

```text
收到消息
  └─ msgType 是 image/voice/video/file？
      ├─ downloadMedia(mediaId)
      ├─ 保存到本地
      ├─ 构建 attachments
      └─ 继续流程 → 最终调用 dispatchReplyWithBufferedBlockDispatcher
```

**需要增加的流程**：

```text
收到消息
  └─ msgType 是 image/voice/video/file？
      ├─ downloadMedia(mediaId)
      ├─ 保存到本地
      ├─ 构建 attachments
**    ├─ [NEW] 如果 knowledge 已配置 → 触发文件索引
**    │     判断：文件类型是否可索引（text/markdown/json/csv/pdf）
**    │     如果是：
**    │       读取文件内容
**    │       计算 chunk、embedding
**    │       写入 VectorStore（命名空间 agent.accountId:agent）
**    │     如果不是：跳过（不支持二进制文件索引）
**    │     异常处理：索引失败不影响主流程（try/catch，只打 log）
**    └─ 继续流程 → dispatchReplyWithBufferedBlockDispatcher
```

**侵入代码量**：约 +15 行（一个小型 check + index 调用块）。

```typescript
// 在 downloadMedia 成功后插入
// ◄ 通路 A：用户上传文件 → accountId:agent 对话级命名空间
try {
  const knowledgeCfg = resolveKnowledgeConfigForAgent(config, agent.accountId);
  if (knowledgeCfg?.enabled && looksText) {
    const content = await fs.readFile(savedPath, 'utf-8');
    await indexDocument(knowledgeCfg, `${agent.accountId}:agent`, {
      id: mediaId,
      content,
      metadata: { filename: originalFileName, msgType, fromUser }
    });
  }
} catch (e) {
  error?.(`[knowledge] file indexing failed: ${String(e)}`);
}
```

**依赖**：
- `indexDocument()` — 需要从 `src/knowledge/indexer/scheduler.ts` 导出
- `resolveKnowledgeConfigForAgent()` — 需要从 `src/knowledge/hooks.ts` 导出（当前已有 `extractKnowledgeConfig`）

#### 8.4.2 侵入点 2：Bot 模式 — 消息触发索引（通路 A）

> **数据来源说明**：本侵入点同样属于**通路 A（用户上传文件 → 对话级索引）**。用户发给 Bot 的文件索引到 `accountId:bot` 命名空间，仅为当前对话提供上下文，**不沉淀为企业知识**。

**位置**：`src/monitor.ts`，`startAgentForStream()` 函数，约第 1262 行（`processInboundMessage` 调用后）。

**原始流程**：

```text
startAgentForStream
  ├─ processInboundMessage(target, msg) → { body, media }
  ├─ ...（路由、鉴权、构建 ctxPayload）
  └─ dispatchReplyWithBufferedBlockDispatcher({ ctx, cfg, ... })
```

**需要增加的流程**：

```text
startAgentForStream
  ├─ processInboundMessage(target, msg) → { body, media }
**├─ [NEW] 如果 knowledge 已配置且本次消息有媒体文件
**│     判断：文件类型是否可索引
**│     如果是 → indexDocument(...)
  ├─ ...（路由、鉴权、构建 ctxPayload）
  └─ dispatchReplyWithBufferedBlockDispatcher({ ctx, cfg, ... })
```

**注意**：Bot 模式的媒体处理与 Agent 模式不同：
- Bot 模式通过 `processInboundMessage()` 处理媒体文件
- 企微 Bot 回调中收到的文件/图片是**加密的 media URL**，需要解密后下载
- 解密逻辑在 `src/media.ts` 中
- 索引逻辑需要在**解密下载完成之后**插入

**侵入代码量**：约 +20 行（比 Agent 多一个 `processInboundMessage` 返回值检查）。

```typescript
// 在 processInboundMessage 返回后插入
const { body, media } = processInboundMessage(target, msg);

// [NEW] 知识库索引
if (media && knowledgeConfig?.enabled) {
  try {
    const indexableTypes = ['text', 'markdown', 'json', 'csv', 'pdf'];
    const fileExt = getFileExtension(media.filename);
    if (indexableTypes.includes(fileExt)) {
      const content = await readFileContent(media.localPath);
      await indexDocument(knowledgeConfig, `${accountId}:bot`, {
        id: media.mediaId,
        content,
        metadata: { filename: media.filename, fromUser: msg.FromUserName }
      });
      logger.info('[KNOWLEDGE] Bot 模式索引成功: ' + media.filename);
    }
  } catch (e) {
    logger.error('[KNOWLEDGE] Bot 模式索引失败: ' + String(e));
  }
}
```

#### 8.4.3 侵入点 3：hooks.ts 配置读取 — 对接 OpenClaw 运行时

**位置**：`src/knowledge/hooks.ts`，`handleBeforePromptBuild()` 和 `resolveConfigForAccount()`。

**问题**：当前 `resolveConfigForAccount()` 尝试从 `(ctx as any).config` 读取配置。但 OpenClaw 的 `before_prompt_build` hook 的 `ctx` 类型是 `PluginHookAgentContext`，**没有 `config` 字段**。

```typescript
type PluginHookAgentContext = {
  runId?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  modelProviderId?: string;
  modelId?: string;
  messageProvider?: string;
  trigger?: string;
  channelId?: string;
};
```

**解决方案**：

有三种方案可选，推荐方案 C（最可靠）：

##### 方案 A：通过 OpenClaw API 获取运行时配置（推荐）

```typescript
// 利用 api 的 channel/config 能力
const wecomCfg = await api.channel.getConfig?.('wecom') 
                 ?? api.config.get?.('channels.wecom');

// 或直接用 api 提供的 getConfig 方法
const config = await api.config.get?.();
```

**可行性分析**：OpenClaw Plugin SDK 是否暴露了运行时配置读取 API？需要确认。

##### 方案 B：在 registerKnowledgeHooks 时捕获一次配置引用

```typescript
export function registerKnowledgeHooks(api: OpenClawPluginApi): void {
  // 在注册时捕获运行时的完整配置引用
  // OpenClaw 在 mount 插件时会将运行时引用传给 plugin-api
  
  let wecomCfg: any;
  try {
    wecomCfg = (api as any).runtime?.config?.channels?.wecom;
  } catch {}
  
  api.on('before_prompt_build', async (event, ctx) => {
    return handleBeforePromptBuild({ ...ctx, wecomCfg });
  });
}
```

**风险**：需要 OpenClaw 插件 API 确实暴露了 `runtime.config` 引用，这属于内部细节，可能随版本变化。

##### 方案 C：通过 hook 的 `trigger`/`channelId` 定位配置（最可靠）

```typescript
async function resolveConfigForAccount(
  event: PluginHookBeforePromptBuildEvent,
  ctx: PluginHookAgentContext,
  api: OpenClawPluginApi,
): Promise<KnowledgeConfig | null> {
  // 1. 判断通道
  if (ctx.channelId !== 'wecom') return null;
  
  // 2. 判断模式
  const isAgent = ctx.trigger?.endsWith('-agent') ?? false;
  
  // 3. 获取配置——通过 api 层访问
  const config = await api.config.get?.();
  if (!config) {
    // 降级：尝试从 ctx 的 workspaceDir 读取 config 文件
    const configPath = path.join(ctx.workspaceDir ?? '', 'config.json');
    // ...
  }
  
  // 4. 提取 knowledge 配置
  const wecom = config?.channels?.wecom;
  if (!wecom?.knowledge?.enabled) return null;
  
  // 5. 获取 accountId——不同模式获取方式不同
  const accountId = resolveAccountId(event, ctx, isAgent);
  
  // 6. 合并配置
  return deepMergeKnowledgeConfig(wecom.knowledge, accounts[accountId]);
}
```

**优点**：完全通过 Plugin SDK 公开 API 操作，不依赖内部结构。
**缺点**：需要 `api.config.get?.()` 存在。

##### 附加问题：accountId 的解析

Bot 模式和 Agent 模式的 accountId 来源不同：

| 模式 | accountId 来源 | 示例 |
|------|---------------|------|
| **Bot** | route 路由绑定，在 ctxPayload.AccountId 中 | `route.accountId`（从 WebhookTarget 解析） |
| **Agent** | `agent.accountId` | `agent.accountId`（从 accounts 配置解析） |
| **hook 的 ctx** | `ctx.agentId` 可能携带 | 需要确认 `ctx.agentId` 在两种模式下是否都传了正确的 accountId |

**建议**：独立验证 `before_prompt_build` 的 `ctx.agentId` 在两种模式下是否等于 accountId。如果不是，需要自己维护从 `ctx.sessionKey` 反推 accountId 的逻辑。

#### 8.4.4 侵入总结表

| # | 文件 | 侵入类型 | 代码量 | 风险 | 数据通路 |
|---|------|---------|--------|------|----------|
| 1 | `src/agent/handler.ts` | +1 个 if 块（文件下载后索引） | ~15 行 | 低 — 纯加法，try/catch 包裹 | 通路 A |
| 2 | `src/monitor.ts` | +1 个 if 块（消息处理后索引） | ~20 行 | 低 — 纯加法，try/catch 包裹 | 通路 A |
| 3 | `src/knowledge/hooks.ts` | 重写 `resolveConfigForAccount` | ~30 行 | **中** — 依赖 OpenClaw Plugin SDK 的运行时 API | 通路 A + 通路 B 共用 |
| 4 | `src/knowledge/indexer/scheduler.ts` | 新增定时调度 + 企微文档 API 调用 | ~60 行 | **中** — 依赖企微 MCP 权限和配置 | **通路 B** |
| **合计** | **4 个文件** | | **~125 行** | | |

#### 8.4.5 通路 B：企微文档拉取 → 企业级知识库（新增侵入点 4）

> **数据来源说明**：本侵入点属于**通路 B（企微文档拉取 → 企业级知识库）**。由管理员指定 `accountId` 的授权账户，通过企微文档 API 主动拉取，索引到该 `accountId` 的全局知识空间。这是平台层面操作，不依赖用户上传，而是依赖管理员对 `accountId` 的授权。

**位置**：`src/knowledge/indexer/scheduler.ts`，新增定时调度任务。

**流程**：

```text
定时调度触发
  └─ [NEW] 如果知识库已启用 且 store.sources 配置了 documentLibrary
       ├─ 获取企微文档 API 凭据（基于 accountId 的 AccessToken）
       ├─ 调用 wecom_mcp.call doc get_doc_content { docId, folderId }
       ├─ 获取文档内容（Markdown/HTML）
       ├─ 计算 chunk、embedding
       ├─ 写入 VectorStore（命名空间 accountId:enterprise）
       ├─ 记录同步状态（lastSyncTime / etag，避免重复拉取）
       └─ 异常处理：同步失败不影响其他 account 的索引（try/catch）
```

**所需企微 API 权限**：

| API | 用途 | 所需 MCP Skill |
|-----|------|-----------------|
| `doc/get_doc_content` | 获取文档内容 | `wecom-doc` |
| `doc/list_by_folder` | 获取文件夹下文档列表 | `wecom-doc` / `wecom-doc-manager` |

**配置示例**：

```json
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,
        "store": {
          "sources": {
            "documentLibrary": {
              "enabled": true,
              "folderId": "FOLDER_ID_XXX",
              "syncInterval": 3600
            }
          }
        }
      }
    }
  }
}
```

**关键约束**：
1. 配置文件必须显式指定 `folderId`/`docId`，不能对所有文档库做全量扫描
2. 写入 `namespace = accountId:enterprise`，与通路 A 的 `accountId:bot/agent` 严格隔离
3. 需要管理员对目标 `accountId` 进行授权——企微 MCP 的 AccessToken 需具有对应文档库的读取权限

**关键技术风险**：侵入点 3（配置读取）依赖 OpenClaw Plugin SDK 是否暴露了配置 API。如果 `api.config.get?.()` 不存在，需要：
1. 在 `registerKnowledgeHooks()` 时主动读取一次完整配置（文件系统），缓存引用
2. 或要求 OpenClaw 核心暴露该 API

#### 8.4.6 验证步骤

1. **先验证侵入点 3** 可行——在 has Node env 的机器上确认 `api.config` 是否存在
2. **再实现侵入点 1、2**——文件索引（通路 A）
3. **再实现侵入点 4**——企微文档拉取（通路 B）
4. **全流程测试**：发文件 → 通路 A 索引 → 问问题 → 命中对话级 RAG
5. **全流程测试**：配置通路 B → 触发定时同步 → 问问题 → 命中企业级 RAG
6. **验证隔离性**：通路 A 的数据不会出现在通路 B 的检索结果中，反之亦然
7. **验证 Bot 和 Agent** 两种模式各自的工作流

### 8.5 开发工作流

```bash
# 1. 打开新分支
git checkout -b feat/custom-vector-store

# 2. 实现 + 测试
# 写代码 -> 写测试 -> 跑测试

# 3. 类型检查
npx tsc --noEmit

# 4. 运行全部知识库测试
npx vitest --config vitest.config.ts src/knowledge/

# 5. 提交
git add -A
git commit -m "feat(knowledge): 添加 MemoryStore 支持"
```

---

**文档版本**：1.0.0
**最后更新**：2026-04-24
**维护者**：PartMe.AI
