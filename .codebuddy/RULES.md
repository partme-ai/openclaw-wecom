# OpenClaw Project Rules

## 分析 OpenClaw 源码

当用户需要分析、了解 OpenClaw 时：

1. 询问用户是否需要分析本地的 OpenClaw 源码来解答问题
2. OpenClaw 源码路径：`/Users/kylexli/PycharmProjects/openclaw`
3. **总是询问用户需要分析的 OpenClaw 版本**，版本通过 git tags 管理，版本号格式为 `v2026.3.11`
4. **一定要确认完需要分析的版本之后，才开始分析**

## 版本切换规则

- 如果切换版本时版本不存在，先尝试 `git fetch --all`，再尝试切换
- 如果仍然不存在，在 tags 中查找相近版本并告知用户。例如用户要切换到 3.14，可以提示："没有该版本，是否需要切换到 v2026.3.13？"

## 聊天插件分析

当用户需要分析 OpenClaw 自带的聊天插件时，首先分析 Discord 和 Telegram 插件的源码，源码位于 `/Users/kylexli/PycharmProjects/openclaw/extensions` 目录。
