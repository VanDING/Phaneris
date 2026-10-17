# 防御逻辑与测试精简：交付报告

状态：治理实施及已运行验证完成；核心聚合回归和独立 server 装配存在下述验证限制。
日期：2026-10-17（Asia/Shanghai）。起点：`062bd1f25ee565e6cc9fffe8b7376177b5c96351`。
对应[先行审计与清单](../process/defensive-code-test-cleanup-2026-10-17.md)。

## 1. 防御逻辑清理

| 修改 | 清理依据与保持的行为 |
| --- | --- |
| WeCom 保存凭据的原样重抛 catch | 没有处理职责；错误继续沿原调用链传播，先保存凭据后尝试连接的顺序保持 |
| onboarding 完全相同的 if/else | 合成一次 API key 检查，删去失效变量和回调依赖；编辑保留 key、loopback 无 key 和 Bedrock 路径保持 |
| 固定工具注册表的可选 Zod 方法、类型检查、空 schema 兜底 | 注册表由本模块创建的 Zod schema 组成；直接调用原生转换，损坏不再伪装成空契约；工具过滤、前缀、properties/required 和元字段删除保持 |
| 自动化 JSON 重复解析 | 内容入口从两次解析降为一次，磁盘入口从三次降为一次；复用私有 schema/语义校验，原始事件名仍用于兼容警告与磁盘诊断路径 |
| 自动化 schema 后的重复形状检查 | 私有函数的两个调用点都先经过真实 schema.safeParse，schema 输出有完整数组、matcher 和 discriminated action；删去重复判空、typeof、in、Array.isArray，保留变量提示和条件语义校验 |
| DAG 私有遍历的三个备用默认值 | materializeDeps 对所有节点建集合且排除未知目标；无环后先逐节点计算 level，再读结果。删除空边和零 level 兜底；外部 TaskSpec 校验、环/悬空引用/尺寸保护保持 |
| 模型首元素重复转换 | 已有 modelIds 后直接复用首项；空模型列表、显式默认值、字符串/对象模型的结果保持 |
| 测试专用 watcher getter | 唯一消费者只测 Map 类型，无实际生产消费者；删除 getter，activeWatchers 注册表和 start/stop/重复检测机制保持 |

未删除认证、权限、Origin、token、路径隔离、Runtime T1/T2、未知副作用恢复、资源清理、并发与生命周期保护。Pi 模型回退只处理特定模型/协议拒绝且保持连接与统一期限，不能视为无差别重试；Webhook 即时/持久延迟恢复有不同职责，本轮保留。未发现足以证明应移除的生产策略/adapter 契约，不因单实现就删除模块边界。

## 2. 测试精简与剩余保障

| 删除/合并 | 证据 | 剩余保障 |
| --- | --- | --- |
| Electron connection-setup 文件：28 项迁至 server-core，11 项重复删除 | 两边直接调用同一 domain 函数；10 项 setup/mask/key-resolution 已有同等行为测试，另一个对象模型用例与保留的 Pi 对象模型回归等价 | domain 文件现有 64 项；#1048 masked credential、对象默认模型比较、模板/错误语义等独有用例完整保留 |
| UI stacking 规则重复套件：4 项删除 | 两个入口都 re-export scripts 中同一 CJS 规则，内容/配置逐字相同 | Electron 目录保留共享规则的 4 项行为测试；全仓 lint 继续使用原规则 |
| renderer skill/source 解析：10 项删除 | renderer 只重导出 shared 解析函数，同样行为已由 shared 更完整的 suite 覆盖 | shared mentions 的 23 项及 renderer 的 33 项特有/其他用例保留 |
| watcher getter：2 项删除 | 仅断言 Map 实例和 size 的类型，空 beforeEach，未运行 start/stop/duplicate 行为 | 生产重复 watcher 与资源清理保持；不宣称原来的这两项曾提供 duplicate 回归保障 |
| CLI run.isolated：12 项及其专用 Mock server/module mock 删除 | 5 项 parser 重复、1 项只检查自设 spawnServer Mock、6 项手动复刻 RPC 流程；没有调用生产 cmdRun，含过时 providerType='anthropic' 夹具 | commands/client 65 项、其余 CLI 连接/事件/服务端 smoke 保留；cmdRun bootstrap 专门 E2E 缺口作为既有问题记录 |

测试和夹具文件净减少 4 个；移除一套专用 Mock WebSocket server、一处 module mock、一份重复 Linter setup 和一个空 hook；未改变 Bun runner、全局初始化或既有 mock 进程隔离。没有新增单元测试，也没有禁用、skip 或放宽失败断言。

## 3. 可核对的效果

| 统计口径 | 清理前 | 清理后 | 变化 |
| --- | ---: | ---: | ---: |
| 生产 src 代码行数 | 340,852 | 340,820 | −32 |
| 测试及夹具代码行数 | 100,232 | 99,541 | −691 |
| 测试及夹具文件 | 612 | 608 | −4 |
| AST 可识别直接 it/test 用例定义 | 5,651 | 5,612 | −39（另迁移 28） |
| 7 个修改生产文件的 if | 337 | 332 | −5 |
| 同范围 catch | 50 | 48 | −2 |
| 同范围条件表达式 / 可选访问 / ?? | 71 / 121 / 88 | 69 / 118 / 83 | −2 / −3 / −5 |

统计包含空行/注释，使用审计开始时的 Git 文件集合；src 排除测试、fixture 和声明，但含 Playground。测试口径包含测试辅助代码和 ESLint rule tests。未把新增报告或一次性证据脚本计入产品精简。AST 定义数量不等于参数化测试的实际执行数量，不能混用。减少量不直接代表质量改善。

## 4. 验证结果

- 改动前：全工作区 6,301 pass、7 skip、0 fail；类型检查及全 lint 通过。
- 改动后：全工作区 6,262 pass、7 skip、0 fail；39 项减少量与删除清单一致，skip 场景及原有 openssl 条件跳过保持不变。单次全测耗时 300.083 → 247.231 秒；两次有不同并行负载与缓存状态，这不是严格性能基准，不归因成固定加速比例。
- 完整 `validate:ci` 退出 0，257.717 秒，覆盖类型、lint、选定配置回归、文档工具、i18n、文档/字体、身份、版本、Python runtime 和 Electron pin 检查。
- 三批验证：73 项工具/DAG/domain、15 项 gateway、101 项自动化、64 项归并后的 domain、37 项 renderer/共享规则、65 项 CLI、23 项 shared mentions，均通过；这些执行有重叠，不相加作为唯一覆盖数。
- 前后行为捕获：8 组完整工具 schema/过滤/前缀组合、22 项自动化内容、23 项自动化磁盘场景、10 项 DAG、20 项模型选择，共 83 组，输出逐字节一致。失败场景在实施前记录，包含坏 JSON、schema、旧事件名、未知事件、正则、时区、cron、Webhook 模板、自循环、环、未知依赖及深度/宽度边界。
- 六组现有 criticalTestGroups 全部补跑通过：243 pass、0 fail，22.232 秒，保留独立模块 Mock 隔离；这些测试与全 workspace 执行重叠，不相加作为唯一用例数。
- 36 个工作流共 500 个场景通过：聚合链在 Markdown 弹出页之前完成 33 个 / 433 场景；独立补跑主题治理 49、分发输入 12、身份 gate 6 场景，产物和必要文件哈希校验通过。
- `test:critical` 聚合命令实际退出 1（1,221.112 秒）：Markdown 弹出页在 Playwright 本机 WebSocket 启动时 ECONNRESET，0 项场景断言执行。没有把启动失败归为业务回归，也没有宣称这条聚合命令通过。
- 曾尝试把该页初始化限定到 fixture 并隔离 Vite cache，370.231 秒内仍未进入断言，随后只停止本次自建测试进程树；两行试验配置已撤回，原脚本与断言保持原样。原始失败和中断日志均保留。
- 尚未执行的 7 个主题浏览器工作流：foundation、contract、roles、domains、browser-host、login、design；聚合链已在前述启动失败处退出，未将这些场景标为通过。
- 最终 Electron main/preload/renderer、WebUI、Viewer 五个生产构建成功；`build:smoke` 后续独立 server 装配拒绝 win32，仅支持 darwin/linux，最终退出 1（215.913 秒），与基线失败点一致。没有修改平台判断或绕过失败。

本机原始证据位于 `.cache/defensive-cleanup-2026-10-17/`，包含初始盘点、日志、前后行为 JSON 及完整工作流 manifest/数据库/截图/trace。归档仅保留结论、哈希及复跑脚本，媒体和临时配置继续留在 cache。

结论产物：[机器统计与删除/迁移清单](results/defensive-cleanup-2026-10-17/evidence-summary.json)、[实施前写好的行为捕获脚本](results/defensive-cleanup-2026-10-17/capture-contracts.ts)。脚本只用于本次前后比对，没有接入 CI 或新增门禁。复跑时指定独立 `PHANERIS_CONFIG_DIR`，在仓库根目录执行：

```sh
bun run docs/verification/results/defensive-cleanup-2026-10-17/capture-contracts.ts .cache/cleanup-contracts.json
bun run test
bun run validate:ci
bun run test:critical --output-dir=.cache/cleanup-critical-unique
bun run build:smoke --output-dir=.cache/cleanup-build-unique
```

工作流输出目录必须是未存在的独立目录。检查某次完整产物可运行 `bun run scripts/verification/verification-artifacts.ts --verify=<该次工作流目录>`；结论归档自身不是工作流目录，不适用该校验。Windows 的最后一条仍具有上述已知平台失败。

## 5. 遗留与结论边界

| 保留项 | 原因与后续所需证据 |
| --- | --- |
| workspace 自动化校验包裹 labels/config I/O 的 catch、磁盘读取返回空结果 | 可能属于尽力提供诊断/可选配置契约，不能只按注释删除；需明确错误传播与用户依赖 |
| 旧模型迁移、第三方 provider 多格式响应/备用发现 | 旧磁盘数据、账号和第三方接口有实际兼容边界；需生产数据/环境证据 |
| Pi setting 的源码文本测试 | 易受重构影响，但尚未证明每项 live setting 已由行为 E2E 替代，暂保留 |
| factory 的单 Pi driver registry / 可选 driver 分支 | 导出入口携带 provider，仍需保留未知 provider 的错误语义及 driver 回退；仅有一个实现不足以证明外部契约可删除 |
| Markdown 弹出页的预打包与浏览器初始化 | 观察到原始依赖扫描 298 秒及本机 WebSocket 失败；缩小预打包范围仍未获得行为验收证据，试验已撤回，需进一步调查 Vite/Bun/Playwright 启动 |
| CLI cmdRun bootstrap 专门 E2E | 原 Mock 套件没有覆盖它，删除不掩盖缺口；未借本次清理新增复杂框架 |
| Windows 上独立 server build smoke、其他平台、签名安装器、真实 provider/IM | 本次环境/凭据范围不能证明，明确不作通过承诺 |

本轮有充分证据的 A/B 项已按优先级实施，保留必要边界和真实回归；C 类问题有记录并暂留。生产控制流更直接，重复测试和无效 Mock 的维护面减少；全仓测试、CI、前后行为比对及已完成工作流支持这些清理。浏览器启动失败与 Windows server 装配限制意味着不能给出全部验证绿色的结论，也没有宣称全仓所有防御均已逐行证明冗余。
