# OpenClaw-WeCom 知识库 RAG 安装与配置指南

> 本指南面向希望为企微 AI 机器人开启知识库 RAG 能力的使用者，覆盖从安装、配置、快速验证到生产部署的完整路径。知识库 RAG 功能内置在 `@partme.ai/openclaw-wecom` 中，无需额外插件安装。

---

**术语速记**：
- **知识库（Knowledge Base）**：向量化的文档集合，供对话时检索
- **Embedding**：把文本转为向量的过程
- **VectorStore**：存储和查询向量的数据库
- **索引（Index）**：将文档读取、切分、嵌入并存入向量库的过程
- **RAG（检索增强生成）**：在对话时检索相关知识，注入到 AI 的上下文

---

## 0. 前置条件

`openclaw-wecom` 自带的 RAG 能力需要以下条件：

| 条件 | 说明 | 默认值 |
|------|------|--------|
| OpenClaw 版本 | ≥ 2026.3.24-beta.2 | - |
| LLM 可用 | API Key 已配置，用于 Embedding 调用 | 复用 LLM 配置 |
| 存储后端 | ZVec 零依赖 / SQLite-Vec 需 `better-sqlite3` | ZVec |
| 企微插件 | `@partme.ai/openclaw-wecom` 已完成基础安装 | - |

> 建议先完成 `openclaw-wecom` 的基础配置（Bot 或 Agent 模式均可），再开启知识库。参考：[openclaw-wecom 基础安装指南](#)

---

## 1. 快速启动（5 分钟）

### 1.1 最小配置

```json
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,
        "embedding": {
          "model": "text-embedding-3-small"
        },
        "store": {
          "provider": "zvec"
        }
      }
    }
  }
}
```

> **说明**：`embedding.baseUrl` 和 `apiKey` 未填写时自动复用 LLM 侧的 OpenAI 兼容配置。

### 1.2 验证知识库是否运行

```bash
# 查看插件状态（确认 knowledge 模块已加载）
openclaw plugins list

# 输出应包含 'wecom' 插件的 knowledge 子模块
```

### 1.3 上传一个测试文档

在企业微信中向 Bot 发送一个 `.md` 或 `.txt` 文件，文件内容会自动索引到知识库。

然后向 Bot 提问相关话题，验证是否能从知识库中检索到相关内容。

---

## 2. 配置详解

### 2.1 完整配置结构

```json
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,

        "embedding": {
          "provider": "openai",
          "baseUrl": "https://api.openai.com/v1",
          "apiKey": "sk-your-key-here",
          "model": "text-embedding-3-small",
          "dimensions": 1536
        },

        "store": {
          "provider": "zvec",
          "dbPath": "/data/knowledge/wecom.db",
          "sources": {
            "docIds": ["doc-001", "doc-002"],
            "docDirs": ["/path/to/docs"],
            "urls": ["https://example.com/docs/api.md"]
          }
        },

        "retrieval": {
          "strategy": "hybrid",
          "topK": 5,
          "minScore": 0.3,
          "keywordBoost": true
        },

        "injection": {
          "position": "system",
          "template": "以下是相关知识库内容：\n\n{context}\n\n请基于以上内容回答用户问题。如果知识库中没有相关信息，请如实告知。",
          "maxChunks": 5,
          "maxTokens": 2048
        },

        "moderation": {
          "enabled": false,
          "rejectionMessage": "抱歉，我无法回答这个问题。"
        }
      }
    }
  }
}
```

### 2.2 各配置项详解

#### `embedding` — Embedding 配置

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `provider` | string | 否 | `"openai"` | 仅支持 OpenAI 兼容 API |
| `baseUrl` | string | 否 | 复用 LLM 配置 | Embedding API 端点 |
| `apiKey` | string | 否 | 复用 LLM 配置 | API 密钥 |
| `model` | string | 否 | `"text-embedding-3-small"` | 嵌入模型 |
| `dimensions` | number | 否 | 模型默认 | 输出向量维度 |

> **推荐模型**：`text-embedding-3-small`（性能/成本平衡）或 `text-embedding-3-large`（更高精度）。
>
> **重要**：`dimensions` 必须与 VectorStore 的配置一致。切换模型后若维度变化，旧索引数据应删除重建。

#### `store` — 向量存储配置

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `provider` | string | 否 | `"zvec"` | 存储引擎（见附录 C） |
| `namespace` | string | 否 | 自动生成 | 需自定义时手动指定 |
| `dbPath` | string | 否 | 随引擎自动 | 持久化数据库路径 |
| `sources` | object | 否 | {} | 文档来源（索引数据） |

**存储引擎选择策略**：

```
你的场景              → 推荐引擎
开发调试              → zvec（零依赖，重启丢失）
单机轻量生产（<10万文档）  → sqlite-vec
性能敏感/高可用          → pinecone / qdrant
已有 PostgreSQL        → pgvector
大规模分布式            → milvus
```

#### `retrieval` — 检索配置

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `strategy` | string | 否 | `"hybrid"` | `vector` / `keyword` / `hybrid` |
| `topK` | number | 否 | `5` | 返回结果数 |
| `minScore` | number | 否 | `0.0` | 最低相似度阈值（0-1） |
| `keywordBoost` | boolean | 否 | `true` | 是否启用 BM25 关键词增强 |

> **策略选择**：
> - `vector`：纯语义检索，适合同义词/意图匹配
> - `keyword`：精确匹配，适合产品编号/专有名词
> - `hybrid`：加权融合（默认 0.7 向量 + 0.3 关键词），适合大多数场景

#### `injection` — 上下文注入配置

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `position` | string | 否 | `"system"` | `system`（系统提示）或 `user`（用户提示） |
| `template` | string | 否 | 见下 | 上下文格式化模板 |
| `maxChunks` | number | 否 | `5` | 注入的最大块数 |
| `maxTokens` | number | 否 | `2048` | 注入的最大 token 数 |

**默认模板**：

```
以下是相关知识库内容，请据此回答用户问题：

{context}
```

> `{context}` 会被替换为检索到的文本块。`position: "user"` 适合需要用户确认上下文的场景。

#### `moderation` — 内容审核（预留）

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `enabled` | boolean | 否 | `false` | 启用内容审核 |
| `rejectionMessage` | string | 否 | 默认消息 | 驳回时返回的消息 |

> 此功能预留供未来实现内容安全过滤。

### 2.3 多账户配置（多租户场景）

不同的企业微信账号（account）可以拥有独立的知识库，配置继承全局值，account 级进行深度覆盖。

```json
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,
        "embedding": { "model": "text-embedding-3-small" },
        "store": {
          "provider": "sqlite-vec",
          "dbPath": "/data/knowledge/default.db"
        },
        "retrieval": { "topK": 5 }
      },
      "accounts": {
        "acme_corp": {
          "name": "Acme Corporation",
          "knowledge": {
            "store": {
              "dbPath": "/data/knowledge/acme.db"
            },
            "retrieval": { "topK": 10, "minScore": 0.5 }
          }
        },
        "globex": {
          "name": "Globex Inc.",
          "store": {
            "provider": "pinecone",
            "pineconeApiKey": "xxx",
            "pineconeEnvironment": "us-east-1",
            "pineconeIndexName": "globex-knowledge"
          },
          "retrieval": { "strategy": "hybrid" }
        }
      }
    }
  }
}
```

**合并规则**：

- `enabled`：继承全局，account 级不可覆盖
- `embedding`：深度合并，account 级字段覆盖全局同名字段
- `store`：深度合并，但 `sources` 字段完全替换（不合并）
- `retrieval` / `injection` / `moderation`：深度合并

> 例如 `acme_corp` 只覆盖了 `store.dbPath` 和 `retrieval.topK`，其余配置继承全局值。

---

## 3. 文档管理与索引

### 3.1 支持的文件格式

| 格式 | 说明 | 示例 |
|------|------|------|
| `.md` | Markdown 文档 | 使用说明、产品文档 |
| `.txt` | 纯文本 | 知识问答、常见问题 |
| `.csv` | 表格数据 | FAQ 对照表 |
| `.json` | JSON 数据 | 结构化知识 |

> 暂不支持 PDF / Word / Excel 等格式（需额外解析依赖）。

### 3.2 三种索引方式

#### 方式一：用户在企微上传文件

用户向机器人发送文件 → 系统自动检测文件类型 → 索引到该用户的命名空间。

```
用户发 .md/.txt 文件到企微
  → Bot/Agent 处理文件
  → 下载 → 切分 → 嵌入 → 写入 VectorStore（命名空间: accountId:mode）
```

**索引日志示例**：
```
[KNOWLEDGE] 索引文档: user_manual.md → namespace=default:bot, 新增 12 个块
[KNOWLEDGE] 索引成功: 12/12 chunks, sourceId=media_abc123
```

#### 方式二：手动索引本地文件

通过 OpenClaw 命令手动触发索引（目标态功能）：

```bash
openclaw run knowledge:index \
  --path /docs/product_manual.md \
  --namespace acme:bot
```

#### 方式三：批量索引目录

```bash
openclaw run knowledge:index \
  --dir /docs/library/ \
  --namespace acme:bot \
  --pattern "*.md"
```

### 3.3 数据管理

```bash
# 查看知识库统计
openclaw run knowledge:stats

# 清空指定命名空间
openclaw run knowledge:clear --namespace acme:bot

# 删除单个文档
openclaw run knowledge:delete --source-id media_abc123
```

---

## 4. 生产部署建议

### 4.1 持久化存储

开发阶段使用 ZVec（内存存储，重启后数据丢失）。生产环境务必切换到持久化后端：

```json
{
  "store": {
    "provider": "sqlite-vec",
    "dbPath": "/var/lib/openclaw/knowledge.db"
  }
}
```

> **注意**：SQLite-Vec 依赖 `better-sqlite3` 原生模块。

### 4.2 Embedding API 安全

- 不使用复用 LLM 配置时，在 Embedding 配置中单独指定 API Key
- 使用独立的 Embedding 模型账户，便于成本跟踪和限流
- 避免在日志中打印完整 API Key

### 4.3 多租户数据路径规划

对多租户场景，建议按以下方式规划数据目录：

```
/var/lib/openclaw/knowledge/
├── default/
│   ├── bot.db      # 默认 Bot 知识库
│   └── agent.db    # 默认 Agent 知识库
├── acme_corp/
│   ├── bot.db      # Acme 公司 Bot 知识库
│   └── agent.db    # Acme 公司 Agent 知识库
└── globex/
    └── bot.db      # Globex 公司 Bot 知识库
```

### 4.4 性能调优

| 参数 | 建议值 | 说明 |
|------|--------|------|
| `chunkSize` | 500-1000 | 文本切分大小（字符数） |
| `chunkOverlap` | 100-200 | 块重叠大小 |
| `topK` | 3-5 | 检索返回结果数 |
| `minScore` | 0.3-0.5 | 相似度阈值，过低引入噪声，过高丢失召回 |

---

## 5. 故障排除

### 5.1 知识库未生效

**症状**：对话中没有知识库上下文注入。

**排查步骤**：
```bash
# 1. 确认 knowledge 配置已启用
openclaw config get channels.wecom.knowledge.enabled

# 2. 确认 embedding 配置正确
openclaw config get channels.wecom.knowledge.embedding

# 3. 查看日志中是否有知识库相关输出
openclaw logs | grep KNOWLEDGE
```

**常见原因**：
- `enabled: false`（未启用）
- Embedding API Key 无效或网络不可达
- 向量维度不匹配（模型切换后未重建索引）
- `minScore` 设置过高，没有命中结果

### 5.2 文件上传后未索引

**症状**：上传文件后，知识库中没有新增数据。

**排查步骤**：
```
1. 确认文件格式在支持列表中（.md/.txt/.csv/.json）
2. 查看日志中是否有索引相关输出
3. 确认文件大小未超出限制（默认 25MB）
```

### 5.3 检索结果不准确

| 症状 | 可能原因 | 解决方案 |
|------|----------|----------|
| 返回结果不相关 | `minScore` 太低 | 提高到 0.3-0.5 |
| 语义匹配丢失 | 使用 `vector` 策略 | 切换到 `hybrid` 策略 |
| 关键词不命中 | 文档内容太短 | 增加 `chunkOverlap` |
| 返回结果太少 | `topK` 太小 | 增加到 5-10 |

### 5.4 错误消息参考

```
[KNOWLEDGE] ERROR: Embedding API 连接失败
  → 检查 baseUrl 和 apiKey 配置

[KNOWLEDGE] ERROR: 向量维度不匹配（expected 1536, got 3072）
  → 切换模型后需重建索引

[KNOWLEDGE] ERROR: 文件格式不支持: .pdf
  → 仅支持 .md/.txt/.csv/.json

[KNOWLEDGE] WARN: 检索未命中任何结果
  → 检查 minScore 或确认知识库非空
```

---

## 6. 从旧版本迁移

如果之前使用了早期的知识库实现：

```bash
# 1. 备份旧数据（如果有）
cp /var/lib/openclaw/knowledge/old_knowledge.db /tmp/backup/

# 2. 更新配置格式
openclaw config set channels.wecom.knowledge '{
  "enabled": true,
  "store": { "provider": "sqlite-vec", "dbPath": "/var/lib/openclaw/knowledge/old_knowledge.db" }
}'

# 3. 重建索引
openclaw run knowledge:reindex --namespace default:bot
```

---

## 附录：配置文件模板

### 最小配置（开发用）

```json
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,
        "embedding": { "model": "text-embedding-3-small" },
        "store": { "provider": "zvec" }
      }
    }
  }
}
```

### 轻量生产配置

```json
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,
        "store": {
          "provider": "sqlite-vec",
          "dbPath": "/var/lib/openclaw/knowledge.db"
        },
        "embedding": {
          "model": "text-embedding-3-small",
          "dimensions": 1536
        },
        "retrieval": {
          "strategy": "hybrid",
          "topK": 5,
          "minScore": 0.3
        },
        "injection": {
          "position": "system",
          "template": "以下是相关知识库内容：\n\n{context}\n\n请基于以上内容回答用户问题。"
        }
      }
    }
  }
}
```

### 多租户生产配置

```json
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,
        "embedding": { "model": "text-embedding-3-small" },
        "store": { "provider": "sqlite-vec" },
        "retrieval": { "topK": 5, "minScore": 0.3 }
      },
      "accounts": {
        "tenant_a": {
          "store": { "dbPath": "/data/knowledge/tenant_a.db" },
          "retrieval": { "topK": 10 }
        },
        "tenant_b": {
          "store": { "dbPath": "/data/knowledge/tenant_b.db" }
        }
      }
    }
  }
}
```

---

**文档版本**：1.0.0
**最后更新**：2026-04-24
**维护者**：PartMe.AI
