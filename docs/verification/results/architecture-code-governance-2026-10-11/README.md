# 架构与代码治理：仓库扫描证据

状态：已完成本机扫描与指定验证；不是全平台发布认证。
记录日期：2026-10-11（Asia/Shanghai）。
源码基线：`8e5bf13b3f393dc776f6c17057eb5d0fb05f2dda`，扫描开始时工作区干净。
用途：[治理实施计划](../../../process/architecture-code-governance-implementation-plan-2026-10-11.md)的事实依据。

## 证据目录

| 文件 | 内容 |
| --- | --- |
| [validation-summary.json](validation-summary.json) | 环境、验证命令/退出码、警告分类、包体字节数、未验证范围 |
| [inventory.json](inventory.json) | 全部 13 个 workspace 的统计、195 份 Markdown 的标题/状态/章节扫描、热点文件 |
| [tracked-files.csv](tracked-files.csv) | 扫描时 3,125 个受版本控制文件的分类、行数、字节数和 SHA-256 |
| [import-graph.json](import-graph.json) | 复用现有边界门禁解析器的 AST 扫描、包依赖、循环候选、类型断言与函数热点 |
| [scan-repository.py](scan-repository.py) | 可复跑的只读文件/文档盘点脚本 |
| [scan-import-graph.ts](scan-import-graph.ts) | 可复跑的只读 AST 盘点脚本；不是新生产门禁 |
| [validate-ci.log](validate-ci.log) | `validate:ci`，退出 0；87 项 Bun 测试及 Python 文档工具 smoke 通过 |
| [test-critical.log](test-critical.log) | 193 项既有测试通过；另有 15 项 Runtime 工作流、8 项进程崩溃场景、23 处违规拒绝 |
| [webui-auth.log](webui-auth.log) | 既有 loopback WebUI 认证回归，15 pass / 0 fail |
| [build-smoke.log](build-smoke.log) | Electron main/preload/renderer、WebUI、Viewer 的真实生产构建和独立 server 分发目录 import smoke |
| [stage-assets.log](stage-assets.log) / [bundle-report.log](bundle-report.log) | Pi 资源重新 staging 后的包体门禁，退出 0 |
| [identity-strict.log](identity-strict.log) | 严格身份检查退出 1：152 处未分类上游标识；常规漂移检查通过 |
| [docs-check.log](docs-check.log) | 新计划接入索引后的文档门禁；103 份文档和全部相对链接通过 |
| [critical-generated-paths.json](critical-generated-paths.json) | 本次 `test:critical` 覆盖的 12 个已提交历史证据文件，已恢复原内容 |
| [SHA256SUMS](SHA256SUMS) | 本目录其余文件的完整性清单 |

日志中的本机仓库绝对路径统一写为 `<repo>`；未隐藏检查结果。命令各自的测试数字有重叠，不能相加作为全仓唯一用例数。

## 复跑

在仓库根目录、已安装锁定依赖的环境中执行：

```sh
python3 docs/verification/results/architecture-code-governance-2026-10-11/scan-repository.py \
  --root . --output-dir .cache/governance-rescan
bun run docs/verification/results/architecture-code-governance-2026-10-11/scan-import-graph.ts \
  --root=. --output=.cache/governance-rescan/import-graph.json
bun run validate:ci
bun run test:critical
bun test ./packages/server-core/src/webui/__tests__/http-server.isolated.ts
bun run build:smoke
bun run electron:build:assets
bun run bundle:report --check
bun run identity:check:strict
```

最后一条在本次基线上预期退出 1。它用于发现尚未分类的标识，不表示常规 `validate:ci` 失败。

**现有脚本副作用**：`test:critical` 内的三个 verification workflow 把输出写入已提交的 `durable-runtime-boundary/` 证据目录，当前没有统一的输出目录开关。本次保存新日志后仅恢复这些由本次运行覆盖的文件。复跑应使用干净的独立 checkout，或先保护已有修改；不要把覆盖后的历史证据误当作产品源码改动。这一问题已纳入计划 G1。

文件扫描读取工作树内容，文件集合来自 `git ls-files`。新增文档提交后总文件数会变化；与本次数字比较时应使用所记录的基线，而不是把后来新增文件当作统计错误。脚本保留输入 HEAD 与状态，供复核。

## 解释边界

- 文件盘点覆盖全部受版本控制文件；二进制仅记录字节数和哈希。未读取用户实际工作区、凭据或会话。
- `production-src` 是 `apps/*/src`、`packages/*/src` 中的代码，排除测试、夹具和 `.d.ts`；其中仍包括位于 `src` 的开发 Playground。它不是最终发布包清单。
- AST 扫描使用 [现有 import graph](../../../../scripts/lib/import-graph.ts)，覆盖 1,462 个模块。Python、CSS、构建入口和资源脚本由文件盘点与定向阅读覆盖，不包含在该 AST 数字里。
- 循环引用是静态候选，包含 barrel 重导出与可能被编译器擦除的类型用途。没有把 16/6 个候选直接宣布为运行时缺陷。
- 39 个「只在根清单声明」候选按 workspace–依赖对计数，考虑了成员的 deps/dev/peer/optional；没有把 SDK 传递依赖、peer 提供者或所有无法解析的 import 宣布为死代码。
- `any`、行数、警告和测试文件数是治理信号，不能替代正确性、覆盖率或真实用户路径验证。
- 本次未运行全量 workspace 测试、性能基准、Docker 镜像构建、Windows/Linux 安装器或真实 provider/IM 服务；未查询远程 Actions 状态或最新外部安全公告。
- build smoke 的 `--skip-download` 使用本机已有运行时；它证明本机装配和 import 解析，不能证明空缓存安装或签名分发。构建期间上述证据文件被重写，部分 build stamp 因而带 `+dirty`；生产源码未变。
