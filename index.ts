import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema, ensureConfigHelpers } from "./src/compat/plugin-sdk-shim.js";

import { handleWecomWebhookRequest } from "./src/monitor.js";
import { setWecomRuntime } from "./src/runtime.js";
import { wecomPlugin } from "./src/channel.js";
import { createWeComMcpTool } from "./src/mcp/index.js";
import { registerKnowledgeHooks, createKnowledgeAddTool,
  createKnowledgeQueryTool, createKnowledgeUpdateTool,
  createKnowledgeDeleteTool } from "@partme.ai/openclaw-knowledge";

const plugin = {
  id: "wecom",
  name: "WeCom",
  description: "OpenClaw WeCom (WeChat Work) intelligent bot channel plugin",
  configSchema: emptyPluginConfigSchema(),
  /**
   * **register (注册插件)**
   *
   * OpenClaw 插件入口点。
   * 1. 注入 Runtime 环境 (api.runtime)。
   * 2. 注册 WeCom 渠道插件 (ChannelPlugin)。
   * 3. 注册 Webhook HTTP 路由（推荐 /plugins/wecom/*，兼容 /wecom*）。
   * 4. 注册 wecom_mcp 工具 (MCP Streamable HTTP 调用)。
   * 5. 注入 MEDIA 指令提示词（仅 wecom 通道），指导 LLM 使用 MEDIA: 语法发送文件。
   * 6. 注册知识库 RAG hooks + CRUD 工具。
   */
  register(api: OpenClawPluginApi) {
    // 初始化兼容层：确保 deleteAccountFromConfigSection 等函数在
    // gateway 启动前绑定完成（register 执行与 gateway startAccount 之间
    // 有充足的异步间隙）。
    void ensureConfigHelpers();

    setWecomRuntime(api.runtime);
    api.registerChannel({ plugin: wecomPlugin });
    const routes = ["/plugins/wecom", "/wecom"];
    for (const path of routes) {
      api.registerHttpRoute({
        path,
        handler: handleWecomWebhookRequest,
        auth: "plugin",
        match: "prefix",
      });
    }

    // 注册 wecom_mcp：通过 HTTP 直接调用企业微信 MCP Server
    api.registerTool(createWeComMcpTool(), { name: "wecom_mcp" });

    // 注入媒体发送指令和文件大小限制提示词（与官方 @wecom/wecom-openclaw-plugin 保持一致）。
    // 仅 wecom 通道注入，避免污染其他通道（如 Telegram/Discord）的 system prompt。
    // deliver 回调中保留兜底正则解析，作为双重保障。
    api.on("before_prompt_build", (_event, ctx) => {
      if (ctx.channelId !== "wecom") return;
      return {
        systemPrompt: [
          "【发送文件/图片/视频/语音】",
          "当你需要向用户发送文件、图片、视频或语音时，必须在回复中单独一行使用 MEDIA: 指令，后面跟文件的本地路径。",
          "格式：MEDIA: /文件的绝对路径",
          "文件优先存放到 ~/.openclaw 目录下，确保路径可访问。",
          "示例：",
          "  MEDIA: ~/.openclaw/output.png",
          "  MEDIA: ~/.openclaw/report.pdf",
          "系统会自动识别文件类型并发送给用户。",
          "",
          "注意事项：",
          "- MEDIA: 必须在行首，后面紧跟文件路径（不是 URL）",
          '- 如果路径中包含空格，可以用反引号包裹：MEDIA: `/path/to/my file.png`',
          "- 每个文件单独一行 MEDIA: 指令",
          "- 可以在 MEDIA: 指令前后附带文字说明",
          "",
          "【文件大小限制】",
          "- 图片不超过 10MB，视频不超过 10MB，语音不超过 2MB（仅支持 AMR 格式），文件不超过 20MB",
          "- 语音消息仅支持 AMR 格式（.amr），如需发送语音请确保文件为 AMR 格式",
          "- 超过大小限制的图片/视频/语音会被自动转为文件格式发送",
          "- 如果文件超过 20MB，将无法发送，请提前告知用户并尝试缩减文件大小",
        ].join("\n"),
      };
    });

    // 注册知识库 RAG hooks（纯加法，不改动原有逻辑）
    registerKnowledgeHooks(api, "channels.wecom.knowledge");

    // 注册知识库 CRUD 工具组
    api.registerTool(createKnowledgeAddTool);
    api.registerTool(createKnowledgeQueryTool);
    api.registerTool(createKnowledgeUpdateTool);
    api.registerTool(createKnowledgeDeleteTool);

    // 知识库使用指引：引导 AI 在适当时调用知识库工具。
    // 仅在 knowledge.enabled 为 true 时注入，避免无关 context 浪费 token。
    const knowledgeEnabled = !!(api.config as any)?.channels?.wecom?.knowledge?.enabled;
    if (knowledgeEnabled) {
      api.on("before_prompt_build", (_event, ctx) => {
        if (ctx.channelId !== "wecom") return;
        return {
          systemPrompt: [
            "【知识库 CRUD 工具】",
            "本插件提供了 4 个知识库工具（企业微信本地 RAG），你可以根据用户指令调用：",
            "",
            "1. wecom_knowledge_add — 写入知识库",
            "   支持三种操作（action 参数区分）：",
            '   - store_text  → content（文本内容）',
            '   - store_file  → filePath（文件路径，附件 URL file:// 前缀去掉得到本地路径）',
            '   - store_summary → topic + text（主题+总结内容）',
            '   用户说"保存这个"、"把这文件变成知识库"、"提炼到知识库"时使用。',
            "",
            "2. wecom_knowledge_query — 检索知识库",
            '   参数：query（必填）、topK、strategy（vector/keyword/hybrid）、sourceId、namespace',
            '   用户问"查一下知识库"、"搜索 XX 相关内容"时使用。',
            "",
            "3. wecom_knowledge_update — 更新知识库条目",
            '   参数：sourceId（必填）、updateType（text/file/summary）、新内容',
            '   用户说"更新一下之前的"、"修改 XX 条目"时使用。',
            "",
            "4. wecom_knowledge_delete — 删除知识库数据",
            '   两种操作（action 参数）：delete_by_source（按 sourceId 删除）、clear（清空命名空间）',
            '   用户说"删除 XX"、"清理知识库"时使用。',
            "",
            "文件路径：用户消息附件 URL 格式为 file:///绝对/路径/文件名，",
            "去掉 file:// 前缀就是本地路径（如 file:///data/files/report.md → /data/files/report.md）。",
          ].join("\n"),
        };
      });
    }
  },
};

export default plugin;
