# 安装

## 环境要求

- 使用仓库 `package.json` 固定的 **Bun 1.4.2** 安装依赖、运行构建工具。
- 准备至少一个模型服务的凭据，或可访问的兼容端点。应用不附带通用大模型。
- 源码包含 macOS、Windows 和 Linux 的支持路径；具体发行包是否经过签名、安装、升级验收，应以该版本的实际发布说明为准。

## 从源码运行

```bash
git clone ssh://git@ssh.github.com:443/VanDING/Phaneris.git
cd Phaneris
bun install --frozen-lockfile
bun run electron:start
```

`bun.lock` 是依赖锁文件。使用 Bun，避免另外生成 npm、Yarn 或 pnpm 锁文件。开发时可用 `bun run electron:dev` 启动支持热更新的开发流程。

## 安装打包版本

`scripts/install-app.sh` 和 `scripts/install-app.ps1` 从指定发行源安装打包产物。必须先指向自己控制的发行源，例如：

```bash
PHANERIS_RELEASE_BASE_URL=https://releases.example.com/phaneris \
  bash scripts/install-app.sh
```

示例域名不是正在运营的服务。发行源须符合 electron-updater generic 的目录布局，如 `<base>/<channel>/latest.yml`。未配置时安装脚本拒绝继续，不会安装上游产品作为替代。没有自有发行源时，可从源码运行或本地打包。

## 首次启动

1. 在设置中的 AI 页面添加[模型连接](phaneris://docs/reference/llm-connections)，配置账户、API Key 或兼容端点。
2. 创建一个[工作区](phaneris://docs/go-further/workspaces)，作为会话和资源的管理范围。
3. 选择工作目录，按需要连接[来源](phaneris://docs/sources/overview)。来源不是开始编辑本地文件的必需条件。

默认数据目录为 `~/.phaneris/`，Windows 对应 `%USERPROFILE%\.phaneris\`。路径定义见仓库的 `packages/shared/src/config/paths.ts`；备份前确认工作区与外部内容的实际位置。

## 更新

源码运行可拉取当前项目分支，再安装固定依赖并重新构建：

```bash
git pull
bun install --frozen-lockfile
bun run electron:build
```

应用内更新依赖明确配置的自有更新源。空配置不表示已接入上游更新服务。正式发行还需要摘要、签名、升级与回退等发布验收。

## 无界面使用

同一代码库提供服务端和 CLI 客户端：

```bash
PHANERIS_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start
bun run apps/cli/src/index.ts run "概述这个仓库"
```

这里是 Bash 示例；PowerShell 使用自己的环境变量赋值方式。远程连接、TLS 和脚本自动化说明见[远程服务端](phaneris://docs/server/remote-server)、[命令行参考](phaneris://docs/reference/cli-reference)及仓库 `docs/guides/cli.md`。
