# WeCom 插件迁移手册：为官方插件新增 Webhook + Agent 模式

## 背景

| | 官方插件 `@tencent/wecom-openclaw-plugin` | 本项目 `@mocrane/wecom` |
|---|---|---|
| **支持的 Bot 模式** | WebSocket 长连接（唯一） | WebSocket + **Webhook (URL 回调)** |
| **支持 Agent 模式** | 否 | **是**（自建应用，XML 回调 + API 回复） |
| **多账号** | 单账号（DEFAULT_ACCOUNT_ID） | 多账号，完全隔离 |
| **消息协议** | SDK WsFrame (JSON) | WebSocket: WsFrame / Webhook: 加密 JSON / Agent: 加密 XML |

**迁移目标**：将本项目的 **Webhook 模式** 和 **Agent 模式** 合并到官方插件中，使官方插件支持三种接入方式。

---

## 三种模式对比

先理解三种模式的本质区别，后续所有迁移工作都围绕这个展开。

| | WebSocket（官方已有） | Webhook / URL 回调（待迁移） | Agent（待迁移） |
|---|---|---|---|
| **适用场景** | 标准 AI Bot | 无法用长连接的环境（防火墙/内网） | 自建企微应用 |
| **连接方式** | 插件主动连 → 企微推送 WsFrame | 企微 POST → 你的 HTTP 地址 | 企微 POST → 你的 HTTP 地址 |
| **消息格式** | JSON（SDK 封装） | 加密 JSON（AES-256-CBC） | 加密 XML（AES-256-CBC） |
| **回复方式** | `wsClient.replyStream()` | 通过 `response_url` 异步推送 | 通过 `cgi-bin/message/send` API |
| **超时限制** | 无（长连接） | 6 分钟（response_url 有效期） | 无（API 主动推送） |
| **所需凭证** | botId + secret | token + encodingAESKey | corpId + corpSecret + agentId + token + encodingAESKey |
| **核心入口** | `monitor.ts` → WSClient 事件 | `monitor.ts` → `handleWecomWebhookRequest()` | `agent/handler.ts` |

```
企微用户发消息
    │
    ├─── WebSocket ──→ SDK WsFrame ──→ processWeComMessage()  [官方已有]
    │
    ├─── Webhook ────→ POST /wecom/bot ──→ 解密 JSON ──→ 防抖聚合 ──→ startAgentForStream()
    │                                                                      │
    │                                                          response_url 推送回复
    │                                                          超时降级 → Agent API 私信
    │
    └─── Agent ─────→ POST /wecom/agent ──→ 解密 XML ──→ 去重 ──→ processAgentMessage()
                                                                      │
                                                          cgi-bin/message/send 回复
```

---

## 官方插件现有模块（不需要动）

以下是官方插件已有的文件，迁移时不需要修改这些文件的核心逻辑：

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/monitor.ts` | 832 | WebSocket 消息处理主流程 |
| `src/channel.ts` | 387 | ChannelPlugin 注册、outbound 发送 |
| `src/state-manager.ts` | 283 | WSClient 实例 + 消息状态 + ReqId 持久化 |
| `src/media-uploader.ts` | 495 | 媒体上传（Base64 分片） |
| `src/media-handler.ts` | 184 | 图片/文件下载保存 |
| `src/message-parser.ts` | 138 | WsFrame 消息内容解析 |
| `src/message-sender.ts` | 54 | replyStream 封装 |
| `src/reqid-store.ts` | 326 | ReqId 持久化（磁盘 + 内存） |
| `src/onboarding.ts` | 157 | 配置引导 UI |
| `src/dm-policy.ts` | 119 | 私聊访问控制 |
| `src/group-policy.ts` | 187 | 群组访问控制 |
| `src/openclaw-compat.ts` | 385 | SDK 兼容层 |
| `src/utils.ts` | 109 | 配置解析（ResolvedWeComAccount） |
| `src/interface.ts` | 176 | 类型定义 |
| `src/const.ts` | 135 | 常量 |
| `src/mcp/*` | 1,034 | MCP 工具 |
| `src/timeout.ts` | 45 | 超时工具 |

---

## 需要迁移的内容

### 任务一：新增加密模块（Agent + Webhook 共用）

**为什么需要**：WebSocket 模式由 SDK 处理加解密，但 Webhook 和 Agent 都是 HTTP 回调，消息是 AES-256-CBC 加密的，需要自行解密。

**来源**：`src/crypto.ts`（176 行）+ `src/crypto/`（多文件共 224 行）

| 源文件 | 行数 | 功能 |
|---|---|---|
| `src/crypto.ts` | 176 | 统一入口：`decryptWecomEncrypted()`, `verifyWecomSignature()`, `encryptForWecom()` |
| `src/crypto/aes.ts` | 108 | AES-256-CBC + PKCS#7 |
| `src/crypto/signature.ts` | 43 | SHA1 签名验证 |
| `src/crypto/xml.ts` | 49 | 加密 XML 提取 |
| `src/crypto/index.ts` | 24 | 导出 |

**操作**：直接复制，无需修改。官方插件目前没有任何加解密代码。

---

### 任务二：新增 Agent 模式（完全独立，零交叉）

| 源文件 | 行数 | 功能 |
|---|---|---|
| `src/agent/handler.ts` | 680 | Agent 消息处理全流程：XML 解析 → 去重 → 媒体下载 → 路由 Agent → API 回复 |
| `src/agent/api-client.ts` | 383 | 企微 API 客户端：AccessToken 管理（缓存+防并发刷新）、sendText/sendMedia、uploadMedia/downloadMedia |
| `src/agent/index.ts` | 12 | 导出 |

**依赖**：
- `src/crypto.ts`（任务一）—— 解密 XML 回调
- `src/shared/xml-parser.ts`（201 行）—— 解析企微 XML
- `src/shared/command-auth.ts`（103 行）—— DM/命令授权
- `src/http.ts`（116 行）—— HTTP 请求封装（undici，支持代理）
- `src/target.ts`（80 行）—— 消息目标解析 `"wecom:user123"` → `{ touser, chatid }`

**操作**：直接复制所有文件。Agent 模式有自己的去重（进程内 Map，10 分钟 TTL），不依赖 StreamStore。

---

### 任务三：新增 Webhook (URL 回调) 模式

这是迁移中**最复杂的部分**，因为本项目的 `monitor.ts`（2,993 行）同时包含 Webhook 和 WebSocket 两种模式的代码，迁移时需要提取 Webhook 专有的逻辑。

#### 3A. 状态管理（直接复制）

| 源文件 | 行数 | 功能 |
|---|---|---|
| `src/monitor/state.ts` | 514 | **StreamStore**：消息去重 + 防抖聚合（500ms 窗口合并连续消息），**ActiveReplyStore**：response_url 生命周期管理（存储/消费/60min TTL） |
| `src/monitor/types.ts` | 140 | StreamState、PendingInbound、WecomWebhookTarget 类型定义 |

> 注意：官方插件的 `state-manager.ts` 是 WebSocket 专用的（管理 WSClient 实例和 ReqId），跟这里的 StreamStore 不冲突，两者并存。

#### 3B. 从 monitor.ts 提取 Webhook 逻辑（需要清理）

`monitor.ts`（2,993 行）中，Webhook 相关的代码占约 2,500 行，其中有约 500 行 `isWsMode` 分支需要去掉。

按功能划分为四个部分：

**HTTP 入口和协议处理**

| 函数 | 行号 | 功能 |
|---|---|---|
| `handleWecomWebhookRequest()` | 2460-2976 | 统一 HTTP 入口：GET 验证 EchoStr / POST 验签→解密→分发（Bot 走 JSON，Agent 走 XML） |
| `readJsonBody()` / `readTextBody()` | 137-301 | HTTP body 解析 |
| `buildEncryptedJsonReply()` | 174-198 | 构造加密 JSON 回复 |
| `registerWecomWebhookTarget()` | 2417-2429 | 注册 Bot HTTP 回调路径 |
| `registerAgentWebhookTarget()` | 2434-2446 | 注册 Agent HTTP 回调路径 |

**消息过滤和解析（Webhook + WebSocket 共用）**

| 函数 | 行号 | 功能 |
|---|---|---|
| `shouldProcessBotInboundMessage()` | 909-928 | 过滤系统消息、缺少 sender/chatid 的消息 |
| `buildInboundBody()` | 2379-2408 | 从消息中提取文本（text/voice/image/file/video/event） |
| `processInboundMessage()` | 959-1133 | 处理媒体消息：解密 URL → 下载 → 保存本地 |

> 官方 WebSocket 模式的 ws-adapter.ts 也调用 `shouldProcessBotInboundMessage()` 和 `buildInboundBody()`，这两个函数需要保持导出。

**核心调度**

| 函数 | 行号 | 功能 |
|---|---|---|
| `flushPending()` | 1151-1192 | 防抖定时器到期后触发，调用 `startAgentForStream()` |
| `startAgentForStream()` | 1229-2359 | **最大函数（1,130 行）**：媒体处理 → 路由解析 → 授权检查 → 调用 Agent → 交付回复 |

`startAgentForStream()` 中的 `isWsMode` 分支（需要去掉的部分）：

| 行号 | 内容 |
|---|---|
| 1297-1347 | WebSocket 模式的本地图片上传 |
| 1401-1412 | WebSocket 模式图片读取失败处理 |
| 1471-1522 | WebSocket 模式非图片文件上传 |
| 1990 | 超时判断跳过（WebSocket 无超时） |
| 2071-2108 | WebSocket 模式 MEDIA 图片上传 |
| 2117-2149 | WebSocket 模式 MEDIA 非图片上传 |

去掉这些分支后，`startAgentForStream()` 从 1,130 行缩减到约 630 行。

**Webhook 专有回复机制**

| 函数 | 行号 | 功能 |
|---|---|---|
| `storeActiveReply()` / `getActiveReplyUrl()` / `useActiveReplyOnce()` | 858-866 | response_url 存储/读取/消费 |
| `pushFinalStreamReplyNow()` | 450-469 | 通过 response_url 推送最终回复 |
| `sendBotFallbackPromptNow()` | 421-448 | 超时降级：6 分钟内没回完 → Agent API 私信 |
| `sendAgentDmText()` / `sendAgentDmMedia()` | 471-524 | Agent API 私信（fallback 通道） |
| `buildStreamReplyFromState()` / `buildStreamPlaceholderReply()` / `buildStreamImmediateTextReply()` | 322-378 | 构造回复 JSON |

---

### 任务四：类型和配置扩展

官方插件目前的账号类型只有 WebSocket 相关字段，需要扩展。

**账号类型对比**：

```typescript
// 官方现有（src/utils.ts）
interface ResolvedWeComAccount {
  accountId: string;
  botId: string;     // WebSocket 用
  secret: string;    // WebSocket 用
  websocketUrl: string;
  // ...
}

// 迁移后需要变成
interface ResolvedWeComAccount {
  accountId: string;
  // WebSocket 模式
  botId: string;
  secret: string;
  websocketUrl: string;
  // Webhook 模式（新增）
  token: string;
  encodingAESKey: string;
  connectionMode: 'webhook' | 'websocket';  // 默认 'websocket'
  // ...
}

// 新增 Agent 账号类型
interface ResolvedAgentAccount {
  corpId: string;
  corpSecret: string;
  agentId: number;
  token: string;
  encodingAESKey: string;
  // ...
}
```

**需要迁移的类型/配置文件**：

| 源文件 | 行数 | 目标 | 说明 |
|---|---|---|---|
| `src/types/message.ts` | 194 | 新建或合并到 `interface.ts` | Bot Webhook 的 JSON 消息类型 + Agent 的 XML 消息类型 |
| `src/types/account.ts` | 114 | 合并到 `utils.ts` | ResolvedBotAccount / ResolvedAgentAccount |
| `src/types/config.ts` | 146 | 合并到 `utils.ts` | WecomBotConfig / WecomAgentConfig |
| `src/types/constants.ts` | 46 | 合并到 `const.ts` | API 地址、Webhook 路径、限制值 |
| `src/config/schema.ts` | 156 | 新建 | Zod 校验（需新增 zod 依赖） |
| `src/config/accounts.ts` | 341 | 合并到 `utils.ts` | 账号解析 + "已配置"判定 + 冲突检测 |

**配置结构变更**：

```yaml
# 官方现有
channels:
  wecom:
    botId: "xxx"
    secret: "xxx"

# 迁移后
channels:
  wecom:
    # Bot 配置
    bot:
      connectionMode: websocket  # 或 webhook
      botId: "xxx"               # WebSocket 模式
      secret: "xxx"              # WebSocket 模式
      token: "xxx"               # Webhook 模式
      encodingAESKey: "xxx"      # Webhook 模式
    
    # Agent 配置（新增，可选）
    agent:
      corpId: "企业ID"
      corpSecret: "应用密钥"
      agentId: 1000001
      token: "回调Token"
      encodingAESKey: "密钥"
```

**"已配置"判定逻辑**：
- WebSocket 模式：`botId` + `secret` 都非空
- Webhook 模式：`token` + `encodingAESKey` 都非空
- Agent 模式：`corpId` + `corpSecret` + `token` + `encodingAESKey` 都非空

---

### 任务五：启动入口适配

官方插件的 `channel.ts` → `gateway.startAccount()` 直接调用 `monitorWeComProvider()` 启动 WebSocket。

迁移后需要根据 `connectionMode` 分流：

```typescript
// 参考本项目 src/gateway-monitor.ts（260 行）的逻辑
async startAccount(ctx) {
  const account = ctx.account;
  
  // Bot 启动
  if (account.bot.connectionMode === 'websocket') {
    // 走官方现有逻辑
    return monitorWeComProvider({ account, ... });
  } else {
    // 注册 Webhook HTTP 路径
    registerWecomWebhookTarget(account, ...);
  }
  
  // Agent 启动（独立于 Bot）
  if (account.agent.configured) {
    registerAgentWebhookTarget(account, ...);
  }
}
```

---

## 迁移总量

| 任务 | 新增代码量 | 难度 | 说明 |
|---|---|---|---|
| 1. 加密模块 | ~400 行 | 低 | 直接复制 |
| 2. Agent 模式 | ~1,575 行 | 低 | 直接复制（handler + api-client + xml-parser + 依赖） |
| 3. Webhook 模式 | ~2,650 行 | **高** | 从 monitor.ts 提取 + 去掉 ~500 行 wsMode 分支 |
| 4. 类型和配置 | ~1,000 行 | 中 | 需要跟官方现有类型合并 |
| 5. 启动入口 | ~260 行 | 低 | 适配分流逻辑 |
| **合计** | **~5,885 行** | | |

---

## 建议的迁移顺序

```
1. 加密模块 ──────────┐
                       ├──→ 3. Webhook 模式 ──→ 5. 启动入口
2. Agent 模式 ────────┘
       │
       └──→ 4. 类型和配置（贯穿所有任务）
```

**推荐先做 Agent 模式**（任务 2），因为它完全独立、代码边界清晰，可以快速验证迁移流程。Webhook 模式（任务 3）留到最后，因为需要从 2,993 行的 monitor.ts 中提取代码并清理 wsMode 分支，工作量最大。

---

## 新增依赖

| 包 | 用途 | 使用方 |
|---|---|---|
| `undici` | HTTP 请求 + 代理支持 | Agent API 客户端 (`api-client.ts`) + Webhook HTTP 处理 |
| `fast-xml-parser` | XML 解析 | Agent 模式 (`xml-parser.ts`) |
| `zod` | 配置校验 | `config/schema.ts` |

官方插件目前的依赖只有 `@wecom/aibot-node-sdk` 和 `file-type`。

---

## 不需要迁移的文件

| 本项目文件 | 原因 |
|---|---|
| `src/ws-adapter.ts` (503 行) | 官方 `monitor.ts` 已有完整的 WebSocket 实现 |
| `src/channel.ts` (250 行) | 官方有自己的 ChannelPlugin 实现 |
| `src/onboarding.ts` (797 行) | 官方有自己的配置引导 |
| `src/outbound.ts` (343 行) | 官方 `channel.ts` 已有 outbound 实现 |
| `src/media/uploader.ts` (240 行) | 官方 `media-uploader.ts` 已有（WebSocket 分片上传） |
| `src/mcp/*` (902 行) | 官方已有独立的 MCP 实现 |
| `src/dynamic-agent.ts` (178 行) | 可选功能，不影响核心迁移 |
| `*.test.ts` (~556 行) | 可参考，不直接迁移 |

---

## 附录：Webhook 模式消息流转

```
1. 用户在企微发消息
2. 企微 POST /wecom/bot
   ├─ query: msg_signature, timestamp, nonce
   └─ body: { encrypt: "..." }
3. handleWecomWebhookRequest()
   ├─ verifyWecomSignature() 验签
   └─ decryptWecomEncrypted() 解密 → JSON 消息
4. shouldProcessBotInboundMessage() 过滤
5. buildInboundBody() 提取文本
6. streamStore.addPendingMessage() 放入防抖队列
7. 立即返回 200 + stream placeholder（用户看到"正在思考"）
   └─ 同时把 response_url 存到 ActiveReplyStore
8. 500ms 防抖结束 → flushPending()
9. startAgentForStream() 调用 OpenClaw Agent
10. Agent 处理完成
    ├─ 6 分钟内：pushFinalStreamReplyNow() 通过 response_url 推送
    └─ 超时：sendBotFallbackPromptNow() 通过 Agent API 私信
```

## 附录：Agent 模式消息流转

```
1. 用户在企微发消息（给自建应用）
2. 企微 POST /wecom/agent
   ├─ query: msg_signature, timestamp, nonce
   └─ body: XML 加密内容
3. handleWecomWebhookRequest()
   ├─ 识别 Agent 路径
   ├─ 解密 XML
   └─ 转交 handleAgentWebhook()
4. 立即返回 200 "success"
5. 异步 processAgentMessage()
   ├─ 解析消息（XML → 类型/发送者/内容）
   ├─ 去重检查（Map + 10 分钟 TTL）
   ├─ 媒体下载（如有）
   ├─ 路由到 OpenClaw Agent
   └─ sendText() / sendMedia() 通过 API 回复
```
