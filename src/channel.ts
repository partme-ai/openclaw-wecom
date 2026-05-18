import type {
  ChannelAccountSnapshot,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";

import {
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "./compat/plugin-sdk-shim.js";

import {
  DEFAULT_ACCOUNT_ID,
  listWeComAccountIds,
  resolveDefaultWeComAccountId,
  resolveWeComAccount,
  resolveWeComAccountConflict,
} from "./config/index.js";
import type { ResolvedWeComAccount, WeComBotConfig } from "./types/index.js";
import { monitorWeComProvider } from "./gateway-monitor.js";
import { setWeComBotConfig, wecomOnboardingAdapter } from "./onboarding.js";
import { wecomOutbound } from "./outbound.js";
import { WEBHOOK_PATHS } from "./types/constants.js";
import QRCode from "qrcode";

const meta = {
  id: "wecom",
  label: "WeCom",
  selectionLabel: "WeCom (plugin)",
  docsPath: "/channels/wecom",
  docsLabel: "wecom",
  blurb: "Enterprise WeCom intelligent bot (API mode) via encrypted webhooks + passive replies.",
  aliases: ["wechatwork", "wework", "qywx", "企微", "企业微信"],
  order: 85,
  quickstartAllowFrom: true,
};

function normalizeWeComMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^(wecom-agent|wecom|wechatwork|wework|qywx):/i, "").trim() || undefined;
}

// onboarding 在 >=3.22 中已重命名为 setupWizard，使用新字段名
export const wecomPlugin: ChannelPlugin<ResolvedWeComAccount> = {
  id: "wecom",
  meta,
  setupWizard: wecomOnboardingAdapter as any,
  setup: {
    resolveAccountId: ({ cfg, accountId }) => {
      return accountId?.trim() || resolveDefaultWeComAccountId(cfg as OpenClawConfig) || DEFAULT_ACCOUNT_ID;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const isWsMode = input.url === "ws" || input.url === "websocket";

      if (isWsMode) {
        // websocket 模式: --bot-token → botId, --token → secret
        const botConfig: WeComBotConfig = {
          connectionMode: "websocket",
          botId: input.botToken?.trim() || undefined,
          secret: input.token?.trim() || undefined,
        };
        return setWeComBotConfig(cfg as OpenClawConfig, botConfig, accountId);
      }

      // webhook 模式: --token → token, --access-token → encodingAESKey
      const botConfig: WeComBotConfig = {
        connectionMode: "webhook",
        token: input.token?.trim() ?? "",
        encodingAESKey: input.accessToken?.trim() ?? "",
      };
      return setWeComBotConfig(cfg as OpenClawConfig, botConfig, accountId);
    },
    validateInput: ({ input }) => {
      const isWsMode = input.url === "ws" || input.url === "websocket";
      if (isWsMode) {
        if (!input.botToken?.trim()) return "websocket 模式需要 --bot-token <BotID>";
        if (!input.token?.trim()) return "websocket 模式需要 --token <Secret>";
      } else {
        if (!input.token?.trim()) return "webhook 模式需要 --token <Token>";
      }
      return null;
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.wecom"] },
  // NOTE: We intentionally avoid Zod -> JSON Schema conversion at plugin-load time.
  // Some OpenClaw runtime environments load plugin modules via jiti in a way that can
  // surface zod `toJSONSchema()` binding issues (e.g. `this` undefined leading to `_zod` errors).
  // A permissive schema keeps config UX working while preventing startup failures.
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: true,
      properties: {},
    },
  },
  config: {
    listAccountIds: (cfg) => listWeComAccountIds(cfg as OpenClawConfig),
    resolveAccount: (cfg, accountId) => resolveWeComAccount({ cfg: cfg as OpenClawConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultWeComAccountId(cfg as OpenClawConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as OpenClawConfig,
        sectionKey: "wecom",
        accountId,
        enabled,
        allowTopLevel: true,
      }) as OpenClawConfig,
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as OpenClawConfig,
        sectionKey: "wecom",
        accountId,
        clearBaseFields: ["bot", "agent"],
      }) as OpenClawConfig,
    isConfigured: (account, cfg) => {
      if (!account.configured) {
        return false;
      }
      return !resolveWeComAccountConflict({
        cfg: cfg as OpenClawConfig,
        accountId: account.accountId,
      });
    },
    unconfiguredReason: (account, cfg) =>
      resolveWeComAccountConflict({
        cfg: cfg as OpenClawConfig,
        accountId: account.accountId,
      })?.message ?? "not configured",
    describeAccount: (account, cfg): ChannelAccountSnapshot => {
      const matrixMode = account.accountId !== DEFAULT_ACCOUNT_ID;
      const conflict = resolveWeComAccountConflict({
        cfg: cfg as OpenClawConfig,
        accountId: account.accountId,
      });
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured && !conflict,
        webhookPath: account.bot?.config
          ? (matrixMode ? `${WEBHOOK_PATHS.BOT_PLUGIN}/${account.accountId}` : WEBHOOK_PATHS.BOT_PLUGIN)
          : account.agent?.config
            ? (matrixMode ? `${WEBHOOK_PATHS.AGENT_PLUGIN}/${account.accountId}` : WEBHOOK_PATHS.AGENT_PLUGIN)
            : WEBHOOK_PATHS.BOT_PLUGIN,
      };
    },
    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveWeComAccount({ cfg: cfg as OpenClawConfig, accountId });
      // 与其他渠道保持一致：直接返回 allowFrom，空则允许所有人
      const allowFrom = account.agent?.config.dm?.allowFrom ?? account.bot?.config.dm?.allowFrom ?? [];
      return allowFrom.map((entry) => String(entry));
    },
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  // security 配置在 WeCom 中不需要，框架会通过 resolveAllowFrom 自动判断
  groups: {
    // WeCom bots are usually mention-gated by the platform in groups already.
    resolveRequireMention: () => true,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  messaging: {
    normalizeTarget: normalizeWeComMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => Boolean(raw.trim()),
      hint: "<userid|chatid>",
    },
  },
  outbound: {
    ...wecomOutbound,
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      webhookPath: snapshot.webhookPath ?? null,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      lastInboundAt: snapshot.lastInboundAt ?? null,
      lastOutboundAt: snapshot.lastOutboundAt ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async () => ({ ok: true }),
    buildAccountSnapshot: ({ account, runtime, cfg }) => {
      const conflict = resolveWeComAccountConflict({
        cfg: cfg as OpenClawConfig,
        accountId: account.accountId,
      });
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured && !conflict,
        webhookPath: account.bot?.config
          ? (account.accountId === DEFAULT_ACCOUNT_ID
              ? WEBHOOK_PATHS.BOT_PLUGIN
              : `${WEBHOOK_PATHS.BOT_PLUGIN}/${account.accountId}`)
          : account.agent?.config
            ? (account.accountId === DEFAULT_ACCOUNT_ID
                ? WEBHOOK_PATHS.AGENT_PLUGIN
                : `${WEBHOOK_PATHS.AGENT_PLUGIN}/${account.accountId}`)
            : WEBHOOK_PATHS.BOT_PLUGIN,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? conflict?.message ?? null,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
        dmPolicy: account.bot?.config.dm?.policy ?? "pairing",
      };
    },
  },
  gateway: {
    /**
     * **startAccount (启动账号)**
     *
     * WeCom lifecycle is long-running: keep webhook targets active until
     * gateway stop/reload aborts the account.
     */
    startAccount: monitorWeComProvider,
    stopAccount: async (ctx) => {
      ctx.setStatus({
        accountId: ctx.account.accountId,
        running: false,
        lastStopAt: Date.now(),
      });
    },

    /**
     * **loginWithQrStart — 生成企业微信机器人扫码添加二维码**
     *
     * 根据账号的 aibotid/botId 生成二维码，用户扫码后可添加机器人。
     * 多账号模式下自动选择对应账号的 bot。
     */
    loginWithQrStart: async (params) => {
      const accountId = params.accountId?.trim() || DEFAULT_ACCOUNT_ID;
      // 从运行时获取当前配置
      const runtime = await import("./runtime.js").then((m) => m.getWeComRuntime());
      const cfg = runtime.config?.loadConfig?.() as OpenClawConfig | undefined;
      if (!cfg) {
        return { message: "无法读取 OpenClaw 配置", connected: false };
      }

      const account = resolveWeComAccount({ cfg, accountId });
      const bot = account.bot;
      if (!bot?.configured) {
        return {
          message: `账号 ${accountId} 未配置 Bot 凭据，请先运行: openclaw channels add wecom`,
          connected: false,
        };
      }

      // 构造企业微信机器人添加链接
      // aibotid 用于 webhook 模式，botId 用于 websocket 模式
      const aibotid = bot.config.aibotid?.trim() || bot.botId?.trim();
      if (!aibotid) {
        return {
          message: "Bot 配置中未找到 aibotid 或 botId，请检查配置",
          connected: false,
        };
      }

      const addUrl = `https://work.weixin.qq.com/wework_admin/commdownload?code=${encodeURIComponent(aibotid)}`;
      const modeLabel = bot.connectionMode === "websocket" ? "WebSocket 长链接" : "Webhook 回调";

      try {
        const qrDataUrl = await QRCode.toDataURL(addUrl, {
          width: 400,
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        });

        return {
          qrDataUrl,
          message: [
            `🤖 企业微信机器人扫码添加`,
            `账号: ${accountId}`,
            `模式: ${modeLabel}`,
            `BotID: ${aibotid}`,
            ``,
            `请使用企业微信扫描上方二维码添加机器人。`,
            `如无法扫码，可在企微中搜索 BotID: ${aibotid}`,
          ].join("\n"),
          connected: true,
        };
      } catch (err) {
        return {
          message: `生成二维码失败: ${err instanceof Error ? err.message : String(err)}`,
          connected: false,
        };
      }
    },

    /**
     * **loginWithQrWait — 企业微信机器人无需等待扫码确认**
     *
     * 企业微信机器人凭据配置完成后即处于可用状态，
     * 不存在 OAuth 式的扫码等待流程。直接返回已连接。
     */
    loginWithQrWait: async (params) => {
      return {
        connected: true,
        message: "企业微信机器人已配置，用户可通过二维码扫码添加。",
      };
    },

    logoutAccount: async ({ cfg, accountId }) => {
      const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
      const account = resolveWeComAccount({ cfg: cfg as OpenClawConfig, accountId: resolvedAccountId });
      // 清除 Bot 凭据即登出
      const cleared = !!(account.bot?.configured);
      if (cleared) {
        await import("./runtime.js").then((m) =>
          m.getWeComRuntime().config?.writeConfigFile?.(
            setWeComBotConfig(cfg as OpenClawConfig, {
              connectionMode: account.bot?.connectionMode ?? "webhook",
              token: "",
              encodingAESKey: "",
              botId: "",
              secret: "",
            }, resolvedAccountId) as any
          )
        );
      }
      return { cleared, loggedOut: cleared };
    },
  },
};
