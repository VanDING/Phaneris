# 复杂度债务治理实施记录

日期：2026-10-28（Asia/Shanghai）  
状态：代码清理与政策收敛已落地，组合验收仍有未闭环项；未提交或推送。  
源码基线：`1910533062d8c33e1f57b7b58b2eba967bc9914f`，v0.5.2。  
执行依据：[审计复核与全面实施方案](complexity-debt-review-and-implementation-plan-2026-10-28.md)。

## 改动与保留边界

| 范围 | 实际实施 | 保留边界 |
| --- | --- | --- |
| S1 | 删除 Session hydrate 的 parity 写入、runtime evidence API、store 读写方法、类型和死查询测试 | parity 计算、分歧日志、canonical 补全与选择保持；旧表和数据保留，无 schema drop |
| S2 | 从 coordinator 移除 settle 时的 usage 审计扫描；纯审计移至 `scripts/verification/model-usage-audit.ts`；工作流直接查询 events/usage | SDK observation 原始持久化、脱敏和所属 run 校验保持，ledger 写入与恢复状态机未变 |
| S4 | 删除旧 skill mention 文件、null guides stub、TTL 重写 helper/专用测试、fast-mode 注入、恒等包装、DDG alias；更新测试导入与 scale 生成清单 | 新 mention、SDK cacheRetention、请求 sanitizer 和搜索行为保留；三个 atom 此前已完成 |
| S7 | 两条 hydration 共享同步 `restoreStoredSession`；移除调用方重复 refresh | 冷模式 `undefined` 才填补字段；热模式原同步规则、消息/usage/队列顺序保持 |
| S6 | 删除单元素 registry、provider availability/映射函数、无效 model guard 和 auth switch；factory 直接使用 piDriver | Pi adapter、连接解析、模型列表限制、认证、兼容 endpoint 与 runtime 路径保持 |
| S5 | 删除重复 policy JSON；registry 作为唯一手写来源，检查非空、唯一 ID、入口、场景下限、产物与测试文件 | CI job id、平台、错误传播、pin、失败证据上传保持；不声称本地同仓门禁能替代独立审批 |
| S3 | 统一 ignore 与验证 README：新运行进 `.cache`，已跟踪 results 冻结保留，长期原物需明确归档 | 未取消任何历史证据跟踪，未重写 Git 历史 |
| S8/P1/P2/P4 | 增加迁移快照工作流、canonical/rollback/canary 验证与运行说明；保留 retry、迁移链、context accounting 和 decision layer | 不因默认关闭或兼容年龄推断可删除；没有真实 decision 样本就不做收益结论 |

各项失败场景已在方案第 6 节先行列出。S1/S2 新断言在移除生产写入前分别出现预期失败；随后 durable 回归 38 项通过。没有为简单删除新增镜像式单测。

## 历史证据与 critical 处置

实际清点结果：1,733 个已跟踪文件，80,544,382 字节；147 份 manifest 中，95 份登记的产物不完整。故障注入 manifest 中的非法/绝对产物路径单独标记，不能当作归档读取目标。

完整路径、字节、SHA-256 和保留决定保存在本地 `.cache/complexity-evidence-inventory.json`，不再复制一份大清单进源码。已有档案继续留在 Git，可由原提交取回；已裁剪的原物明确不宣称仍完整。没有执行取消跟踪或额外远端上传。

critical 仍为 65 workflow、6 package group、2 native workflow，其中 21 个为升级命名。当前以 registry 与既有场景/必要产物为覆盖入口，保留所有独有行为；未按文件名或静态引用数量退役。现有 timing 受环境、冷构建和故障退出影响，没有可比前后样本，不宣称 CI 成本下降。

执行清单、package script 入口、Session 动态 suite 说明及本地各 manifest 的平台/Bun/起止时间观察，保存在 `.cache/complexity-coverage-and-timings.json`。该文件是本次盘点产物，未进入执行策略或新增门禁；没有替代覆盖证明的工作流保持注册。

审计历史对已删除文件的引用改为固定基线的 GitHub blob，保留所讨论的原代码；原结论内容没有重写。

## 验证结果

通过项与组合验证使用从 npm 缓存取得的固定 Bun 1.4.3，未覆盖用户全局 Bun；最初的先行失败探针在原本的 Bun 1.4.2 下记录。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `typecheck:all` | 通过 | `.cache/complexity-typecheck-final.log` |
| `lint` | 通过，含 boundaries/cycles/RPC/distribution 等门禁 | `.cache/complexity-lint.log` |
| durable store/coordinator/usage/parity 回归 | 38 pass | 本次命令输出；相关 E2E 另列 |
| `verify:session-foundation` | 最终代码重跑：7 个 workflow、51 个场景通过；foundation 要求 10 场景及新增必要产物 | `.cache/verification/session-foundation-suite-50j8h7/manifest.json` |
| cold metadata + source auto retry | 19 pass | `.cache/complexity-cold-retry-tests.log` |
| search resolver + fallback | 既有两组回归通过 | `.cache/complexity-search.log` |
| interceptor 与 native cacheRetention | 14 pass | `.cache/complexity-interceptor.log` |
| title generation | 2 pass | `.cache/complexity-title.log` |
| branch rollback / pre-tool-use 隔离回归 | 3 / 71 pass | `.cache/complexity-branch-rollback.log`；`.cache/complexity-pre-tool-use.log` |
| 现有配置回归 | 51 pass | `.cache/complexity-config-tests.log` |
| 迁移快照 | 4 个真实子进程配置场景通过 | `.cache/verification/config-migration-snapshot-2JDh0m/manifest.json` |
| governance gates / closeout | 10 / 28 场景通过 | `.cache/verification/governance-gates-HZJnW5/manifest.json`；`.cache/verification/governance-closeout-hXeWZq/manifest.json` |
| endpoints / B1 | 4 / 5 场景通过 | `.cache/complexity-endpoints.log`；`.cache/complexity-b1.log` |
| context integrity | 8 场景通过 | `.cache/verification/run-context-integrity-NKXi1k/manifest.json` |
| LLM connections / Pi models | 22 / 10 pass | `.cache/complexity-llm-connections.log`；`.cache/complexity-models-pi.log` |
| 文档工具 / UI table | 24 / 4 pass | `.cache/complexity-doc-tools.log`；`.cache/complexity-ui-table.log` |
| i18n、身份、版本、Python/Electron pin、字体 | 通过 | 本次命令输出；配置与依赖版本未更改 |
| `test:critical` | 前 34 个 workflow 完成，theme-foundation 产物场景数未达到下限 | `.cache/verification/critical-lpjaZP/manifest.json`；`.cache/complexity-critical.log` |
| 五个生产 bundler | Electron main/preload/renderer、WebUI、Viewer 串行通过 | `.cache/complexity-build-smoke-serial.log` |
| 完整构建 smoke | Server 分发构建拒绝 win32，未通过 | `.cache/verification/build-smoke-CUUn6W/manifest.json` |
| 最终文档与补充静态检查 | 文档门禁、diff 空白检查、新脚本 ESLint 通过；最后的死 getter 清理后 shared 类型检查与缓存回归通过 | `.cache/complexity-shared-final.log`；`.cache/complexity-interceptor-final.log`；本次命令输出 |

### 未闭环项与新增观察

1. **usage-ledger E2E 未通过。** 当前树在 `metering-XA-run`（T1 回执之前中止）得到 parked、没有 T2/ledger row，符合保守恢复，但旧验收期待 terminal 与已知零用量。原工作流与原 coordinator 的独立基线探针也得到 parked，失败于较早的 `l5-run`；两次位置不同，不能据此声称已精确证明 XA 是基线问题，更不能把断言降级为接受任意 parked。保留 `.cache/complexity-usage-ledger.log`、`.cache/complexity-usage-baseline.log` 和各失败目录。
2. **source activation E2E 未通过。** 真正 provider 请求的工具列表中没有 fixture 要求的 `source_test`。当前结果是失败，不以较小的 retry 回归替代它。证据为 `.cache/complexity-source-activation.log`。
3. **interruption E2E 未通过。** `lost-send-result` 结算后 `blocked` 为 false，验收要求 true。替换为基线 SessionManager 的探针在相同行、相同断言复现；这验证了该失败不是本次 hydration 提取造成。它并非完整干净 checkout 的全面基线验收。证据为 `.cache/complexity-interruption.log` 与 `.cache/complexity-interruption-baseline.log`。
4. **迁移并非首轮完全幂等。** 旧 Bedrock provider 在首轮转换为 Pi，第二轮才补 `modelSelectionMode='userDefined3Tier'`。快照明确锁定这一项差异，并要求第三轮稳定；没有改动 phase 顺序或借清理修复配置语义。其余输入要求第二轮不变，一次性 restore 后用户主动移除模型继续有效。
5. **首次构建 smoke 无效。** 与 critical 同时构建 WhatsApp worker，读取到尚未写完的共同输出，出现截断语法错误。本次验证编排有误；该次失败不能用于判断源码回归，需待 critical 构建结束后串行重跑。没有修改 worker 实现。
6. **critical 覆盖下限未满足。** theme-foundation 子流程 exitCode=0、产出 103 个场景，但 registry 要求至少 115，因此聚合正确失败。前 34 个 workflow 完成；后续 30 个 workflow 与 package groups 未在这条聚合链执行。主题工作流与 115 下限均未在本次改动，仍需核对平台条件与缺少场景，不通过调低下限放行。
7. **串行构建的平台限制。** 五个生产 bundler 和 WhatsApp worker 均已通过；随后 `build-server.ts` 明确报 `Unsupported platform: win32. Use darwin or linux.`，故 Server 分发与移出源码树后的运行验证未执行。需要在 Linux/macOS 完成这一部分，不能把本机五个构建成功说成完整 smoke 通过。

没有执行 `validate:full` 全库聚合、其他平台原生客户端、真实 provider/OAuth 或签名安装器。`validate:ci` 的类型、lint、Session、共享配置/模型/连接、文档工具、table、i18n、文档/字体、身份/版本和 pin 子项分别执行；未把分项结果冒充完整跨平台 CI。

迁移链后续退出需逐 phase 证明最老受支持输入仍可升级，且保全 workspace、连接列表、默认值和用户主动选择；不能用纯读时别名替代。P1 继续保留协议 major 兼容与服务端 retry 生命周期，P2 保留紧急回滚，P4 context 保留现有产品职责，decision 收益仍为证据不足。

### 现有迁移阶段的所有权与退出条件

| 阶段 | 负责输入 / 输出 | 当前保留原因 |
| --- | --- | --- |
| 1a-bis | 旧 Codex/Copilot 连接 → Pi provider 与认证映射 | 最老受支持配置范围未缩减 |
| 1b | 旧 Opus ID/default → 当前连接可选模型 | 后续模型列表过滤前需要归一化 |
| 1c | 连接模型列表/默认值补全与 selection mode | 新旧 provider 形态不同；快照已记录两轮启动差异 |
| 1d | 全局 modelDefaults → connection.defaultModel | 写入字段随后删除，读时映射不能代替 |
| 1e | 归一化 1d 新引入的模型 | 与 1b 的输入时间点不同 |
| 1f | workspace 旧 Opus 默认值迁移 | 数据归属 workspace，不只根连接配置 |
| 1g | 连接 Sonnet 旧值迁移 | 保留原默认值与列表策略 |
| 1h | workspace Sonnet 默认值迁移 | 与连接配置分属不同文件 |
| 1j | Bedrock/Vertex/compat 等旧 provider → Pi transport | 新形态还要交给后续归一化处理 |
| 1j-bis | 修复 customEndpoint 与 pi_compat 的 transport 约束 | 属结构修复，不能仅保留模型别名 |
| 1k | 归一化 provider 迁移引入的 ID 与可用性 fallback | 依赖 1j，不能前移成单一首轮模型遍历 |
| 1m | 一次性 Opus 4.6 restore 与对象形状修复 | marker 后尊重用户主动移除；形状修复独立于 marker |

各阶段当前均保留。退出需要明确最老配置支持边界、对应快照/既有集成覆盖与必要备份；不以函数年龄或重复函数名作为删除条件。

## 交付状态

修改保留在当前工作树，原有 `AGENTS.md`、原审计与规划改动继续保留。未提交、推送、修改远端审批规则、运行用户配置迁移或移除历史证据。组合验收问题解决之前，不把本次标记为可发布的全量验收完成。
