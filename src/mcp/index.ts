/**
 * MCP 模块统一导出
 */

export { createWeComMcpTool } from "./tool.js";
export {
  sendJsonRpc,
  clearCategoryCache,
  clearAccountCache,
  resolveCurrentAccountId,
  McpRpcError,
  McpHttpError,
  type McpToolInfo,
  type SendJsonRpcOptions,
} from "./transport.js";
export { cleanSchemaForGemini } from "./schema.js";
// chatId 请通过 monitor/state 的 getSessionChatInfo(sessionKey) 获取
// 避免 parseSessionKeyChat 反解导致 chatId 被小写化（企业微信 API 大小写敏感）
