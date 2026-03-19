import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import plugin from "./index.js";

describe("wecom plugin register", () => {
  it("registers both recommended and legacy webhook route prefixes", () => {
    const registerChannel = vi.fn();
    const registerHttpRoute = vi.fn();
    const registerTool = vi.fn();
    const on = vi.fn();
    const api = {
      runtime: {},
      registerChannel,
      registerHttpRoute,
      registerTool,
      on,
    } as unknown as OpenClawPluginApi;

    plugin.register(api);

    expect(registerChannel).toHaveBeenCalledTimes(1);
    expect(registerHttpRoute).toHaveBeenCalledTimes(2);
    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/plugins/wecom",
        auth: "plugin",
        match: "prefix",
      }),
    );
    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/wecom",
        auth: "plugin",
        match: "prefix",
      }),
    );
  });

  it("registers wecom_mcp tool", () => {
    const registerChannel = vi.fn();
    const registerHttpRoute = vi.fn();
    const registerTool = vi.fn();
    const on = vi.fn();
    const api = {
      runtime: {},
      registerChannel,
      registerHttpRoute,
      registerTool,
      on,
    } as unknown as OpenClawPluginApi;

    plugin.register(api);

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerTool).toHaveBeenCalledWith(
      expect.anything(),
      { name: "wecom_mcp" },
    );
  });

  it("injects MEDIA prompt only for wecom channel via before_prompt_build", () => {
    const registerChannel = vi.fn();
    const registerHttpRoute = vi.fn();
    const registerTool = vi.fn();
    const on = vi.fn();
    const api = {
      runtime: {},
      registerChannel,
      registerHttpRoute,
      registerTool,
      on,
    } as unknown as OpenClawPluginApi;

    plugin.register(api);

    // Should register before_prompt_build listener
    expect(on).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith("before_prompt_build", expect.any(Function));

    const handler = on.mock.calls[0][1];

    // Non-wecom channel: should return undefined (no injection)
    expect(handler({}, { channelId: "telegram" })).toBeUndefined();
    expect(handler({}, { channelId: "discord" })).toBeUndefined();

    // Wecom channel: should return appendSystemContext with MEDIA instructions
    const result = handler({}, { channelId: "wecom" });
    expect(result).toBeDefined();
    expect(result.prependContext).toContain("MEDIA:");
    expect(result.prependContext).toContain("【发送文件/图片/视频/语音】");
    expect(result.prependContext).toContain("【文件大小限制】");
  });
});
