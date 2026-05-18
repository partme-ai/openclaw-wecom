# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **OpenClaw Channel Plugin** for WeCom (企业微信 / WeChat Work). It enables AI bot integration with enterprise WeChat through a multi-mode architecture.

- **Package**: `@partme.ai/wecom`
- **Type**: ES Module (NodeNext)
- **Entry**: `index.ts`

## Architecture

### Multi-Mode Design (WebSocket + Webhook Bot + Agent)

The plugin implements three connection modes:

| Mode | Purpose | Webhook Path | Capabilities |
|------|---------|--------------|--------------|
| **WebSocket** (Bot 长连接) | Real-time streaming chat | N/A (WS) | Streaming responses, low latency |
| **Webhook** (Bot URL 回调) | HTTP callback for restricted networks | `/wecom`, `/wecom/bot`, `/plugins/wecom/bot` | Streaming via `response_url`, 6min window, Agent fallback |
| **Agent** (自建应用) | Fallback & broadcast | `/wecom/agent`, `/plugins/wecom/agent` | File sending, broadcasts, long tasks (>6min) |

**Key Design Principle**: Bot is preferred for conversations; Agent is used as fallback when Bot cannot deliver (files, timeouts) or for proactive broadcasts.

### Core Components

```
index.ts              # Plugin entry - registers channel and HTTP handlers
src/
  channel.ts          # ChannelPlugin implementation, lifecycle management
  monitor.ts          # WebSocket message processing + backward-compat webhook handler
  runtime.ts          # Runtime state singleton
  http.ts             # HTTP client with undici + proxy support
  crypto.ts           # AES-CBC encryption/decryption for webhooks
  media.ts            # Media file download/decryption
  outbound.ts         # Outbound message adapter
  target.ts           # Target resolution (user/party/tag/chat)
  dynamic-agent.ts    # Dynamic agent routing (per-user/per-group isolation)
  gateway-monitor.ts  # Account lifecycle: dispatch WS / webhook gateway / agent registration
  ws-adapter.ts       # WebSocket client adapter (@wecom/aibot-node-sdk)

  # ── Webhook mode (integrated from @wecom/wecom-openclaw-plugin) ──
  webhook/
    index.ts          # Re-exports: handler, gateway, state, helpers, types
    handler.ts        # HTTP GET/POST handler with multi-account signature matching
    gateway.ts        # Lifecycle: start/stop webhook targets, prune timer
    monitor.ts        # startAgentForStream() — message processing, Agent dispatch, deliver
    state.ts          # StreamStore + ActiveReplyStore + WebhookMonitorState (singleton)
    helpers.ts        # buildInboundBody, processInboundMessage, buildFallbackPrompt, MIME detect
    types.ts          # WebhookInboundMessage, StreamState, PendingInbound, WecomWebhookTarget
    target.ts         # Path-indexed target registry (register/unregister/resolve)
    http.ts           # undici fetch wrapper with ProxyAgent
    media.ts          # AES-256-CBC media decryption (decryptWecomMediaWithMeta)
    command-auth.ts   # DM policy + command authorization
    video-frame.ts    # ffmpeg first-frame extraction for video messages

  agent/
    api-client.ts     # WeCom API client with AccessToken caching
    handler.ts        # XML webhook handler for Agent mode
    webhook.ts        # Agent HTTP handler (GET echostr verify, POST XML decrypt)
  config/
    schema.ts         # Zod schemas for configuration
    accounts.ts       # Account resolution, mode detection, conflict checking
    network.ts        # Proxy resolution chain
    routing.ts        # Fail-closed routing policy
  monitor/
    state.ts          # StreamStore and ActiveReplyStore (WebSocket mode)
    types.ts          # StreamState, PendingInbound types
  mcp/                # wecom_mcp tool: JSON-RPC over Streamable HTTP
  crypto/             # AES-256-CBC, SHA1 signature, XML encrypt/decrypt
  media/              # Media uploader, constants
  shared/             # XML parser, command auth utilities
  types/              # TypeScript types: config, account, message, constants
  compat/             # SDK version compatibility shim
```

### Stream State Management

The plugin uses sophisticated stream state systems for both modes:

**WebSocket mode** (`src/monitor/state.ts`):
- **StreamStore**: Manages message streams with 6-minute timeout window
- **ActiveReplyStore**: Tracks `response_url` for proactive pushes
- **Pending Queue**: Debounces rapid messages (500ms default)
- **Message Deduplication**: Uses `msgid` to prevent duplicate processing
- Exports `getSessionChatInfo()` for MCP tool context (preserves original-case chatId)

**Webhook mode** (`src/webhook/state.ts`):
- Separate singleton (`WebhookMonitorState`) with same StreamStore + ActiveReplyStore pattern
- Additional `conversationState`/`batchKey`/`ackStream` queue semantics for multi-message merge
- Used by `webhook/gateway.ts` and `webhook/monitor.ts`

### Token Management

Agent mode uses automatic AccessToken caching (`src/agent/api-client.ts`):
- Token cached with 60-second refresh buffer
- Automatic retry on expiration
- Thread-safe refresh deduplication

## Development Commands

### Testing

This project uses **Vitest**:

```bash
# Run all tests
npx vitest --config vitest.config.ts run

# Run specific test file
npx vitest --config vitest.config.ts run src/crypto.test.ts

# Run tests matching pattern
npx vitest --config vitest.config.ts run -t "should encrypt"

# Watch mode
npx vitest --config vitest.config.ts --watch
```

Test files are located alongside source files with `.test.ts` suffix (16 test files total):
- `src/crypto.test.ts`
- `src/monitor.integration.test.ts`
- `src/monitor/state.queue.test.ts`
- etc.

### Type Checking

```bash
npx tsc --noEmit
```

### Build

The plugin is loaded directly as TypeScript by OpenClaw. No build step is required for development, but type checking is recommended. For distribution, use `npm pack`.

## Configuration Schema

Configuration is validated via Zod (`src/config/schema.ts`):

```typescript
{
  enabled: boolean,
  bot: {
    connectionMode: 'websocket' | 'webhook',
    // WebSocket mode:
    botId: string,
    secret: string,
    // Webhook mode:
    token: string,              // Bot webhook token
    encodingAESKey: string,     // AES encryption key
    receiveId: string?,         // Optional receive ID
    streamPlaceholderContent: string?,  // "Thinking..."
    welcomeText: string?,
    dm: { policy, allowFrom }
  },
  agent: {
    corpId: string,
    corpSecret: string,
    agentId: number,
    token: string,              // Callback token
    encodingAESKey: string,     // Callback AES key
    welcomeText: string?,
    dm: { policy, allowFrom }
  },
  accounts: {                   // Multi-account (matrix mode)
    main: { bot: {...}, agent: {...} }
  },
  network: {
    egressProxyUrl: string?     // For dynamic IP scenarios
  },
  media: {
    maxBytes: number?           // Default 20MB
  },
  dynamicAgents: {
    enabled: boolean?           // Enable per-user/per-group agents
    dmCreateAgent: boolean?     // Create agent per DM user
    groupEnabled: boolean?      // Enable for group chats
    adminUsers: string[]?       // Admin users (bypass dynamic routing)
  }
}
```

### Dynamic Agent Routing

When `dynamicAgents.enabled` is `true`, the plugin automatically creates isolated Agent instances for each user/group:

```bash
# Enable dynamic agents
openclaw config set channels.wecom.dynamicAgents.enabled true

# Configure admin users (use main agent)
openclaw config set channels.wecom.dynamicAgents.adminUsers '["admin1","admin2"]'
```

**Generated Agent ID format**: `wecom-{type}-{peerId}`
- DM: `wecom-dm-zhangsan`
- Group: `wecom-group-wr123456`

Dynamic agents are automatically added to `agents.list` in the config file.

## Key Technical Details

### Webhook Security

- **Signature Verification**: SHA1(token, timestamp, nonce, encrypt) via `@wecom/aibot-node-sdk` WecomCrypto
- **Encryption**: AES-256-CBC with PKCS#7 padding (32-byte blocks)
- **Paths**: `/wecom` (legacy), `/wecom/bot` (bot), `/wecom/agent` (agent), `/plugins/wecom/bot/*`, `/plugins/wecom/agent/*`

### Timeout Handling

Bot webhook mode has a 6-minute window (360s) for streaming responses. The plugin:
- Tracks deadline: `createdAt + 6 * 60 * 1000`
- Switches to Agent fallback at `deadline - 30s` margin
- Sends DM via Agent for remaining content

### Media Handling

- **Inbound**: Decrypts WeCom encrypted media URLs (AES-256-CBC)
- **Outbound Images**: Base64 encoded via `msg_item` in stream
- **Outbound Files**: Requires Agent mode, sent via `media/upload` + `message/send`
- **Max Size**: 20MB default (configurable via `channels.wecom.media.maxBytes`)

### Proxy Support

For servers with dynamic IPs (common error: `60020 not allow to access from your ip`):

```bash
openclaw config set channels.wecom.network.egressProxyUrl "http://proxy.company.local:3128"
```

### message tool denial

`buildCfgForDispatch()` in `webhook/helpers.ts` adds `"message"` to `tools.deny` to prevent Agent from bypassing Bot delivery via the message tool.

## Testing Notes

- Tests use Vitest with co-located test files
- Integration tests mock WeCom API responses
- Crypto tests verify AES encryption round-trips
- Monitor tests cover stream state transitions and queue behavior

## Common Patterns

### Adding a New Message Type Handler

1. Update `buildInboundBody()` in `src/webhook/helpers.ts` or `src/monitor.ts` to parse the message
2. Add type definitions in `src/types/message.ts`
3. Update `processInboundMessage()` if media handling is needed

### Agent API Calls

Always use `api-client.ts` methods which handle token management:

```typescript
import { sendText, uploadMedia } from "./agent/api-client.js";

// Token is automatically cached and refreshed
await sendText({ agent, toUser: "userid", text: "Hello" });
```

### Stream Content Updates

Use `streamStore.updateStream()` for thread-safe updates:

```typescript
streamStore.updateStream(streamId, (state) => {
  state.content = "new content";
  state.finished = true;
});
```

## Dependencies

- `@wecom/aibot-node-sdk`: Official WeCom Bot WebSocket SDK + crypto
- `undici`: HTTP client with proxy support
- `fast-xml-parser`: XML parsing for Agent callbacks
- `file-type`: MIME type detection from file buffers
- `zod`: Configuration validation
- `openclaw`: Peer dependency (>=2026.2.24)

## WeCom API Endpoints Used

- `GET_TOKEN`: `https://qyapi.weixin.qq.com/cgi-bin/gettoken`
- `SEND_MESSAGE`: `https://qyapi.weixin.qq.com/cgi-bin/message/send`
- `SEND_APPCHAT`: `https://qyapi.weixin.qq.com/cgi-bin/appchat/send`
- `UPLOAD_MEDIA`: `https://qyapi.weixin.qq.com/cgi-bin/media/upload`
- `DOWNLOAD_MEDIA`: `https://qyapi.weixin.qq.com/cgi-bin/media/get`
