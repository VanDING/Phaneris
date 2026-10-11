# 独立审计后的治理收口验收

本机治理实施与列明的验收完成。源码基线 `8e5bf13b3f393dc776f6c17057eb5d0fb05f2dda`，当前工作树未提交或推送。完整变更与边界见 [实施台账](../../../process/governance-completion-2026-10-11.md)；[初次 G3–G8 快照](../governance-completion-2026-10-11/README.md) 保留审计修复前记录。

| 验收 | 实际结果 |
| --- | --- |
| 完整类型/lint/i18n/身份/runtime/文档/回归 | 13 workspace + 4 tooling；workspace 6,285 pass / 14 skip / 0 fail；CI 重复子集 87 次执行另计；CPython 3.12.15 文档工具 24 项另计 |
| critical | 21 工作流、235 独立场景；6 组既有回归 243 pass / 0 fail；聚合 27 项是工作流/组数量，不能当作测试数 |
| Web / native Electron | Web 24 场景（含离线切换、文件 capability 与 reconnect 状态）；实际原生 20 场景（含最新草稿、权限/计划/取消与致命错误有界退出）；零未处理异常 |
| 构建/分发/干净安装 | 14 项生产 build smoke，五项 loose resource 缺失均在监听前失败；离树 Pi/Host 6 场景；独立空缓存 frozen install 4 场景 |
| 预算 | main 21,455,588 B ≤ 21,500,000；renderer 初始 HTML JS 图 819,228 B / 14 chunks ≤ 4,800,000；三个最终性能采样均在原预算内 |
| 故障与门禁 | 真实 vault/backend、logout/workspace、CI 触发/条件/失败/上传、registry、ESLint 真实配置、目录外 I/O/别名、Session 全闭包、冷 uv 实际执行、插件备份丢失均复验 |
| 冻结记录 | 初始扫描与前两轮 319 个原文件 SHA 不变；初次 G3–G8 归档 304 个文件独立校验通过 |

此目录是 **curated archive**，不是完整运行目录。`selection-manifest.json` 列出 36 个源运行的原 manifest SHA、247 个保留产物和 1,740 个显式排除产物。包括 9 个修复前/过程中的失败运行；失败仍保留原退出码，不能当成成功证据。临时配置、vault、依赖、浏览器 profile 与构建二进制没有复制；不要直接调用全运行目录 verifier 判断被排除文件损坏。

最终完整回归见 `logs/validate-full-final-6.log`。前一次全库回归因既有文件监听测试固定等待 300ms 而失败，原输出保留在 `logs/validate-full-final-5.log`；正向等待改为有 2 秒截止时间的实际事件等待，原有隔离/清理断言保持，随后三次独立复查与完整回归均通过，见 `analysis/session-watcher-repeats.json`。

`critical/` 各原 manifest 保留命令、时间、运行时、dirty 源文件摘要、场景、退出码与原产物表。`analysis/` 保存最新 AST census、职责/契约/分发输入、当前源快照、预算指纹及归档 canary。`logs/` 保存完整命令输出；`performance/` 保存三次原始采样、截图与日志。运行起点的源摘要是历史事实，不能要求所有运行起点的文档或后来归档 hash 与当前状态相同。

独立校验（仅 Python 标准库）：

```sh
python3 docs/verification/results/governance-closeout-2026-10-11/verify-archive.py
python3 docs/verification/results/governance-closeout-2026-10-11/verify-source.py
```

第二条核对当前仓库的 runtime/governance 改动输入与基线；移走此目录后传入仓库路径即可。源快照覆盖第一方 source/build/validation 输入与根元数据，不把归档自身纳入循环 hash。归档 verifier 核对全文件 SHA、原 manifest SHA、保留产物字节数、场景去重和保留/排除集合完整性。文件篡改、额外文件、重新计算 SHA 后的排除清单缺失都被 canary 拒绝。哈希用于核对字节和来源，不能单独证明外部平台执行成功。

本机 Docker daemon/硬件虚拟化不可用，Linux 容器 CI 本轮未远端执行；Windows/Linux 原生、签名/公证/安装器与真实外部 provider/OAuth/IM/TLS 仍按 release-readiness 验收。SessionManager 仍持有产品编排，历史 electronAPI 与合法 peer/dev 依赖仍兼容保留。本轮没有把这些边界写成已经彻底移除。
