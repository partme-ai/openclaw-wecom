import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { handleWecomWebhookRequest } from "./src/monitor.js";
import { setWecomRuntime } from "./src/runtime.js";
import { wecomPlugin } from "./src/channel.js";

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
   */
  register(api: OpenClawPluginApi) {
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
  },
};

export default plugin;
