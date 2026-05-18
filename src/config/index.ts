/**
 * WeCom 配置模块导出
 */

export { WeComConfigSchema, type WeComConfigInput } from "./schema.js";
export {
    DEFAULT_ACCOUNT_ID,
    detectMode,
    listWeComAccountIds,
    resolveDefaultWeComAccountId,
    resolveWeComAccount,
    resolveWeComAccountConflict,
    resolveWeComAccounts,
    isWeComEnabled,
} from "./accounts.js";
export { resolveWeComEgressProxyUrl, resolveWeComEgressProxyUrlFromNetwork } from "./network.js";
export { DEFAULT_WECOM_MEDIA_MAX_BYTES, resolveWeComMediaMaxBytes } from "./media.js";
export { resolveWeComFailClosedOnDefaultRoute, shouldRejectWeComDefaultRoute } from "./routing.js";
