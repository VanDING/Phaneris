# Main 分支整合：2026-10-21

范围：所有本地分支、两个工作树中的未提交源码/文档/验证产物，以及三份历史 stash 的内容核查。用户要求最终只保留 main。

实施前失败矩阵：

| 风险 | 验收条件 |
| --- | --- |
| 未提交内容在切分支或合并中丢失 | 两个工作树逐文件 SHA-256 清单、完整补丁、独立快照提交；提交后核对树与清单 |
| 字体/主题迁移覆盖升级行为，或旧升级版本覆盖主题 | 以共同基线三方合并；逐项处理冲突，合并双方功能与严格断言；组合源码重新验收 |
| 已 squash 的历史 CI 或旧 stash 恢复过期锁文件/品牌 | 核查差异及后继实现，保留原历史和恢复材料；不回退已批准版本和现有行为 |
| 合并验收仍引用隔离树旧绿项 | 新 main 上重新执行适用完整门禁、关键 E2E、构建和原生/打包验收，绑定 HEAD/源码/锁文件指纹 |
| 工作树清理导致被忽略的证据丢失 | 原始.cache同盘移至独立归档区，核对目录的卷与文件标识；保留已有manifest与路径映射，副本未完成全量SHA时不得当作唯一恢复来源 |
| 删除仍有独有内容的分支或破坏远端 | 清理前确认所有分支可从 main 到达；SSH 仅操作 origin，不强推、不跳过钩子；远端失败明确报告 |

初始状态：E:\Phaneris 与隔离树均基于 ac85d33b0，main/origin 的本地记录为 82714e2ae；frontimprove 已是 main 祖先。另有 CI squash 前历史分支和三个旧 stash。SSH 首次读取远端失败，连接在 ssh.github.com:443 被关闭；本地整合继续，远端状态尚未刷新。

## 整合决定

- 主题/前端快照：`4d3f014e7`，460 个文件；升级修复快照：`0c0a69d31`，130 个文件。原文件 SHA-256 清单和完整补丁位于主工作区 `.cache/merge-main-20261021/`；Git bundle 已通过完整性校验。
- 三方合并共 10 处文本冲突：保留后续升级的账本、压缩阈值、严格场景/产物要求及文档；Chat Starters 输入使用主题侧 text-body。其余主题、字体、视觉基线及新增设计工作流均合入。
- 旧 CI 分支 `5216ac7ad` 的实质内容已由 `062bd1f25` squash 收录；仅余三文件差异为 squash 后 Gantt 焦点/退出等待、watch:null 及其两份说明。保留 main 的后继修复，通过保留历史的合并记录原提交，避免恢复已证实的竞态。
- 三份 stash 逐一核查：2026-10-09 的 Windows 可执行路径、Default 主题名称、Files 打包验收说明均已进入现行实现；旧 Pi 1.1.0 Proposed 状态已被实现和归档取代，旧运行 JSON 仅属历史。2026-08-21、2026-07-20 两份只含旧 bun.lock 状态，已由当前冻结依赖图取代。原 stash 提交与父提交并入 main 历史、补丁与 bundle 外存，现行源码不回退。
- SSH 直连被关闭；本次命令使用已存在的本地代理转发 SSH，未修改仓库远端或全局 SSH 配置。刷新后 origin/main 仍为 `82714e2ae`。

本轮最终验收待执行；此前隔离树和主题树各自的绿色结果属于原快照，不代替本次组合验收。

## 组合验收首轮发现与先行修复边界

- validate:ci 的类型、lint、共享测试与文档工具已通过，最终 check:docs 因本文未进入索引而失败；补链接，不放宽可达性要求。
- 官方 npm 审计新增四条 high，分别影响 follow-redirects 1.16.0（两条凭据泄露）和 markdown-it 14.3.1（两条二次复杂度拒绝服务）。已核对 [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8)、[GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c)、[GHSA-gfr2-rv44-r23c](https://github.com/advisories/GHSA-gfr2-rv44-r23c)、[GHSA-r7fv-28h4-cvq7](https://github.com/advisories/GHSA-r7fv-28h4-cvq7)。只精确 pin 修复版本 follow-redirects 1.16.1、markdown-it 14.3.3；不得增加安全豁免或改原39项目标，重新冻结安装、审计和所有消费链 E2E。既有 OCR critical 有本地补丁与实际安全流程，不扩大旧基线。其余新报 low/moderate 保留原文，不伪称零漏洞。
- 首轮设计 W1/W2、axe 与六格视觉基线通过；长会话仅 LS1 初次200轮稳定画面为22154ms，超出20000ms预算。原红项保留，最终独立复跑；不得放宽门槛。
- 已中止首轮后续 critical 及剩余门禁，原日志、已生成 manifest 与源码身份保留，不标为通过。修复后完整重跑。

## 最终组合验收

测试基线为 `1aa6346e605906d0ee2d5449d4c4177eaa3dac1a`（main），锁文件 SHA-256 为 `3028077c5f935148338eccf9792b53d8f076a0cedd4d1c5255d4c12e19ae2c9d`。收尾提交仅更新验收文档与机器结果；产品目录和锁文件必须与该测试基线一致。

| 范围 | 最终结果 |
| --- | --- |
| 全部升级门禁 | 32 通过、0 失败、1 环境受限（Windows 不支持 server-build） |
| 完整 critical | 65 个工作流 + 6 个包级组，71/71；原始目录 `.cache/verification/critical-z1gS8j/` |
| 设计 W1 / W2、长会话、axe、视觉基线 | 5 项全部通过，与上述 HEAD 和锁文件一致 |
| 原生与 unpacked | 实际 Electron 附件/nativeImage/ConPTY、仓库外打包、重开及第二实例深链接通过；未验证签名安装器与其他操作系统 |
| 安全审计 | 两项 patch 升级后无新增 high/critical；原风险基线未扩张，其余 low/moderate 保留，原 OCR/cache 加固流程通过 |

最终长会话初次200轮稳定画面为16858ms，原预算20000ms未改；首轮22154ms红项与中止的首轮门禁原文均保留，不能混作最终绿项。

[升级机器结果](results/upgrade-2026-10-18.json)记录全部33项命令、退出码、运行前后源码身份及日志SHA；[本轮整合验收](results/main-consolidation-2026-10-21.json)汇总关键工作流、5项主题验收、快照与归档映射。

## 内容保全与清理范围

- 原始两个工作树共590份文件均已按原始SHA-256复原并归档，包括混合换行的原字节；Git规范化的快照提交与原始副本分别保留。
- 三份stash还含3份独立未跟踪文件：Pi1.1计划已归档并更新实施状态；assessment JSON与现行版本相同；tsconfig.base现行版本新增Node/Bun types。原件、原提交及其父提交均保留。
- 合并内容核对：371个主题侧独有文件、41个升级侧独有文件、89个双方修改文件；独有文件的例外仅为两份安全依赖清单、本文、pressable.ts末尾空行。原文档及补丁见主工作区 `.cache/merge-main-20261021/`。
- origin经SSH读取仅有main；所有4个本地非main分支头和3份stash均已成为main祖先。清理范围为这4个分支、已合入的stash引用和独立工作树；不清理upstream只读引用或Phaneris发布标签。
- 原隔离工作树的整个 `.cache/` 将在同一卷中整体移动到 `C:/Users/dotty/.codex/verification-archives/Phaneris-upgrade-20261021/.cache/`。清理前后核对dev/ino标识，保留原目录和所有文件本体；原manifest不改字节，绝对路径按此映射查找。原验收工作流的manifest/日志/锁文件指纹独立核验。可再生node_modules和dist不作为独立用户内容归档。
- E盘 `E:/Phaneris/.cache/merge-main-20261021/archives/isolated-upgrade/` 保留完整复制副本；10.1万文件的副本全量SHA核验因I/O成本中止，原日志保留，不将该副本标为已验收。恢复以同盘保留的原始.cache为准；实际迁移身份记录在本机归档回执中。
- 原分支/工作树清单、两份二进制补丁、原文件副本、stash补丁/原件、通过校验的Git bundle与归档核对保存在上述主工作区缓存。实际Git收尾状态单独写入 `.cache/merge-main-20261021/cleanup-receipt.json`；最终同步正常执行pre-push的validate:ci，不跳过钩子、不强推。
