/**
 * WeCom 类型统一导出
 */

// 常量
export * from "./constants.js";

// 配置类型
export type {
    WeComAccountConfig,
    WeComDmConfig,
    WeComGroupConfig,
    WeComMediaConfig,
    WeComNetworkConfig,
    WeComRoutingConfig,
    WeComBotConfig,
    WeComAgentConfig,
    WeComConfig,
    WeComDynamicAgentsConfig,
} from "./config.js";

// 账号类型
export type {
    ResolvedWeComAccount,
    ResolvedBotAccount,
    ResolvedAgentAccount,
    ResolvedMode,
    ResolvedWeComAccounts,
} from "./account.js";

// 消息类型
export type {
    WeComBotInboundBase,
    WeComBotInboundText,
    WeComBotInboundVoice,
    WeComBotInboundVideo,
    WeComBotInboundStreamRefresh,
    WeComBotInboundEvent,
    WeComBotInboundMessage,
    WeComAgentInboundMessage,
    WeComInboundQuote,
    WeComTemplateCard,
    WeComOutboundMessage,
} from "./message.js";
