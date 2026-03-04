# Wecom Plugin Fork 开发规范

本项目是 `@yanhaidao/wecom` OpenClaw 企微插件的 fork，以 `@mocrane/wecom` 名称发布到 npm。
以下规则适用于每次从上游拉取代码合并时。

## 上游与本地关系

- **上游包**: `@yanhaidao/wecom`（原作者 YanHaidao）
- **本地包**: `@mocrane/wecom`（fork 维护者 mocrane）
- 合并方向：上游 → 本地，全量覆盖源码，再叠加本地定制

## 合并流程

### 第一步：全量同步源码

从上游（远程服务器或 npm）拉取最新代码，用 rsync 或逐文件覆盖到本地，**排除以下文件**：
- `package.json` — 本地维护，不覆盖
- `clawdbot.plugin.json` — 本地独有文件，不覆盖
- `.git/` — 不覆盖
- `.idea/` — 不覆盖
- `node_modules/` — 不覆盖

### 第二步：叠加本地定制

同步完成后，逐项检查并恢复以下本地定制：

#### 1. 去除作者信息
- `index.ts`：删除 `// Author: YanHaidao` 注释（如有）
- `src/monitor.ts`：`ERROR_HELP` 常量置为空字符串 `""`
- `src/agent/handler.ts`：`ERROR_HELP` 常量置为空字符串 `""`
- `src/onboarding.ts`：删除作者推广文案（包含 YanHaidao 联系方式、公众号等引导文字）

#### 2. 保留 setGatewayBindLan
- `src/onboarding.ts` 中保留 `setGatewayBindLan` 函数及其调用：
```typescript
function setGatewayBindLan(cfg: OpenClawConfig): OpenClawConfig {
    return {
        ...cfg,
        gateway: {
            ...(cfg.gateway ?? {}),
            bind: "lan",
        },
    } as OpenClawConfig;
}
```
- 该函数在 onboarding 流程的最后一步（汇总之前）被调用：`next = setGatewayBindLan(next);`

#### 3. 替换包名和作者引用
在以下文件中将 `@yanhaidao/wecom` 替换为 `@mocrane/wecom`：
- `README.md` — 安装命令、CDN 图片 URL、维护者署名
- `CLAUDE.md` — 包名引用

在测试文件中将 `yanhaidao` userid 替换为 `testuser`：
- `src/monitor.integration.test.ts`

**注意**：`README.md` 中的原始设计徽章、原作者 credit、以及 `GOVERNANCE.md` 中的作者信息属于开源协议要求的归属声明，**不要修改**。

#### 4. package.json 维护
本地 `package.json` 不从上游覆盖，但合并时需手动更新：
- `peerDependencies.openclaw` — 与上游保持一致
- `files` 数组 — 如上游新增了顶层目录（如 `changelog/`），需加入
- `version` — **使用当天日期作为版本号**，格式为 `YYYY.M.D`（例如 2026 年 3 月 4 日 → `2026.3.4`）。发布或部署前更新为当天日期。
- 以下字段始终保持本地值不变：
  - `name`: `@mocrane/wecom`
  - `openclaw.install.npmSpec`: `@mocrane/wecom`
  - `clawdbot` 配置段（整段保留）

### 第三步：验证

合并完成后执行以下检查：
1. `grep -r "@yanhaidao" --include="*.ts" src/ index.ts` — 应无结果
2. `grep -r "@yanhaidao" --include="*.json" . --exclude-dir=node_modules` — 仅 `package-lock.json` 可有（自动生成）
3. `grep -r "YanHaidao" --include="*.ts" src/ index.ts` — 应无结果
4. 确认 `clawdbot.plugin.json` 未被覆盖

### 第四步：发布

```bash
# 升版本号
npm version patch  # 或指定版本如 npm version 2026.x.x

# 发布
npm publish --access public
```

## npm 发布配置

- 包名：`@mocrane/wecom`
- 访问级别：`--access public`
- registry：`https://registry.npmjs.org`（确保非镜像源）
- 需要 npm 登录且启用 2FA

## 远程服务器部署

将本地代码部署到远程服务器替换原版插件时，按以下流程操作。

### 服务器环境

- 已知测试服务器：`43.129.230.69`（root / Huang486!）
- Node.js 通过 nvm 安装，路径：`/root/.nvm/versions/node/v22.22.0/bin`
- pnpm 路径：`/root/.local/share/pnpm`
- **每条 SSH 命令都需要设置 PATH**（非交互式 SSH 不会加载 .bashrc/.profile）：
  ```bash
  export PATH="/root/.nvm/versions/node/v22.22.0/bin:/root/.local/share/pnpm:$PATH"
  ```
- 插件目录：`/root/.openclaw/extensions/wecom/`
- 配置文件：`/root/.openclaw/openclaw.json`

### 部署步骤

#### 1. 删除远程原版插件

```bash
rm -rf /root/.openclaw/extensions/wecom
```

#### 2. 上传本地代码（rsync）

```bash
sshpass -p 'Huang486!' rsync -avz \
  --exclude='.git' \
  --exclude='.idea' \
  --exclude='node_modules' \
  --exclude='package-lock.json' \
  /Users/kylexli/PycharmProjects/wecom/ \
  root@43.129.230.69:/root/.openclaw/extensions/wecom/
```

#### 3. 修复文件所有权（关键！）

rsync 从 macOS 上传后文件 uid 是 501（macOS 用户），OpenClaw 会校验插件目录属主必须是 root (uid=0)，否则拒绝加载，报错：
```
plugin not found: wecom (uid=501, expected uid=0 or root)
```
**必须执行**：
```bash
chown -R root:root /root/.openclaw/extensions/wecom
```

#### 4. 安装依赖

```bash
cd /root/.openclaw/extensions/wecom && pnpm install
```

#### 5. 更新 openclaw.json 中的插件安装记录

原版安装记录指向 `@yanhaidao/wecom`，需要更新为本地版本，否则安全审计会报 unpinned/stale：

```bash
openclaw config set plugins.installs.wecom.spec "@mocrane/wecom"
openclaw config set plugins.installs.wecom.version "2026.2.27"  # 替换为实际版本
openclaw config set plugins.installs.wecom.resolvedName "@mocrane/wecom"
openclaw config set plugins.installs.wecom.resolvedVersion "2026.2.27"
openclaw config set plugins.installs.wecom.resolvedSpec "@mocrane/wecom@2026.2.27"
```

#### 6. 重启 Gateway

```bash
openclaw gateway start
```
此命令会自动 restart systemd 服务。**不要用** `openclaw stop`（该命令不存在）。

#### 7. 验证部署

```bash
# 检查插件加载
openclaw plugins list | grep wecom
# 预期：WeCom | wecom | loaded | global:wecom/index.ts | <本地版本号>

# 检查 channel 状态
openclaw status | grep -A 1 WeCom
# 预期：WeCom | ON | OK | configured

# 检查 gateway 运行
openclaw status | grep Gateway
# 预期：reachable，state active
```

### 已知坑点

1. **PATH 问题**：远程 `openclaw` 和 `node` 命令在非交互式 SSH 下找不到，每条命令必须手动 export PATH
2. **文件属主**：rsync 上传后 uid=501，OpenClaw 拒绝加载非 root 属主的插件目录，必须 `chown -R root:root`
3. **openclaw stop 不存在**：没有 `stop` 子命令，用 `openclaw gateway start` 来重启（它会自动 restart systemd 服务）
4. **安装记录残留**：`openclaw.json` 中 `plugins.installs.wecom` 会保留原版 `@yanhaidao/wecom` 的记录，需要手动通过 `openclaw config set` 更新，否则安全审计报 stale/unpinned

## 文件说明

| 文件 | 用途 |
|------|------|
| `clawdbot.plugin.json` | 本地独有，Clawdbot 兼容配置 |
| `openclaw.plugin.json` | 上游同步，OpenClaw 插件声明 |
| `GOVERNANCE.md` | 上游同步，保留原作者归属 |
| `LICENSE` | 上游同步，不修改 |
