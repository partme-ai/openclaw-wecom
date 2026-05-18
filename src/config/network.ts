import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { WeComConfig, WeComNetworkConfig } from "../types/index.js";

export function resolveWeComEgressProxyUrlFromNetwork(network?: WeComNetworkConfig): string | undefined {
  const proxyUrl = network?.egressProxyUrl ??
    process.env.OPENCLAW_WECOM_EGRESS_PROXY_URL ??
    process.env.WECOM_EGRESS_PROXY_URL ??
    process.env.HTTPS_PROXY ??
    process.env.ALL_PROXY ??
    process.env.HTTP_PROXY ??
    "";
    
  return proxyUrl.trim() || undefined;
}

export function resolveWeComEgressProxyUrl(cfg: OpenClawConfig): string | undefined {
  const wecom = cfg.channels?.wecom as WeComConfig | undefined;
  return resolveWeComEgressProxyUrlFromNetwork(wecom?.network);
}
