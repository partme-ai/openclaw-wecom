import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

import { resolveWeComFailClosedOnDefaultRoute, shouldRejectWeComDefaultRoute } from "./routing.js";

describe("resolveWeComFailClosedOnDefaultRoute", () => {
    it("defaults to true in matrix mode", () => {
        const cfg: OpenClawConfig = {
            channels: {
                wecom: {
                    enabled: true,
                    accounts: {
                        a: { enabled: true, bot: { token: "t1", encodingAESKey: "k1" } },
                    },
                },
            },
        } as OpenClawConfig;
        expect(resolveWeComFailClosedOnDefaultRoute(cfg)).toBe(true);
    });

    it("defaults to false in legacy mode", () => {
        const cfg: OpenClawConfig = {
            channels: {
                wecom: {
                    enabled: true,
                    bot: { token: "t1", encodingAESKey: "k1" },
                },
            },
        } as OpenClawConfig;
        expect(resolveWeComFailClosedOnDefaultRoute(cfg)).toBe(false);
    });

    it("respects explicit override", () => {
        const cfg: OpenClawConfig = {
            channels: {
                wecom: {
                    enabled: true,
                    bot: { token: "t1", encodingAESKey: "k1" },
                    routing: { failClosedOnDefaultRoute: true },
                },
            },
        } as OpenClawConfig;
        expect(resolveWeComFailClosedOnDefaultRoute(cfg)).toBe(true);
    });
});

describe("shouldRejectWeComDefaultRoute", () => {
    const matrixCfg = {
        channels: {
            wecom: {
                enabled: true,
                accounts: {
                    a: { enabled: true, bot: { token: "t1", encodingAESKey: "k1" } },
                },
            },
        },
    } as OpenClawConfig;

    it("rejects default route in matrix mode when dynamic agent is disabled", () => {
        expect(
            shouldRejectWeComDefaultRoute({
                cfg: matrixCfg,
                matchedBy: "default",
                useDynamicAgent: false,
            }),
        ).toBe(true);
    });

    it("does not reject when route already matched a binding", () => {
        expect(
            shouldRejectWeComDefaultRoute({
                cfg: matrixCfg,
                matchedBy: "binding.account",
                useDynamicAgent: false,
            }),
        ).toBe(false);
    });

    it("does not reject when dynamic agent routing is enabled", () => {
        expect(
            shouldRejectWeComDefaultRoute({
                cfg: matrixCfg,
                matchedBy: "default",
                useDynamicAgent: true,
            }),
        ).toBe(false);
    });
});
