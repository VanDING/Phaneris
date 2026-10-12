# 主题宿主、例外与回滚

状态：accepted（工程契约）；正式包三平台和实机验收按产物分别登记。

当前字段、内置清单和校验来自[生成契约](theme-contract.generated.md)，JSON 在[manifest](theme-contract.generated.json)。规划来源为 `7891559`；原始审计和历史验收保持冻结。

当前[481 场景本机验收](../verification/results/theme-governance-w2-w5-2026-10-12/README.md)含 Windows 生产 bundles 的真实 Electron 13 场景；macOS/Linux CI 已接线但尚无本轮运行证据。正式包、物理移动设备与长会话性能保持 open。

| 宿主 / 消费方 | 初始化与更新 | 配色责任 |
| --- | --- | --- |
| Electron / WebUI | API ready 后读偏好；generation、事件和重连补读；原子发布 snapshot | DOM、portal、标题栏和 Shiki 共享实际模式、token 和 revision；scenic 故障回退 Default |
| Viewer | 默认跟随系统；手动明暗选择单独保存，系统变化不覆盖 | Canonical Default、opaque host、reactive Shiki；转录与 overlay 一起更新 |
| Browser toolbar / empty | main 按 workspace 取持久偏好；有序 HostThemeInput；同一 compiler | 临时 preview 保持主窗口作用域；独立窗口跟随已提交偏好；scenic 校验后 chrome 保持 opaque |
| Native browser overlay | toolbar 回报 concrete accent / on-accent；拒绝错窗口、子 frame、错 URL 和旧 sequence | border / agent label 属于应用；网页不接收私有定义或图片 |
| 登录页 | 未认证用生成 Default + OS，认证后才读私有偏好 | 保留品牌装饰；文字、表面、输入、焦点和错误色共享 token；允许浏览器缩放 |
| Code / Mermaid | reactive Shiki / DOM fallback，cache 按 revision；Mermaid 随 cascade 更新 | 宿主语义色；显式 forced syntax theme、用户 SVG 保留自身所有权 |
| Terminal | chrome、普通文字、状态和 copy target 使用角色 | ANSI span 和输出原色不被重写 |
| PDF / HTML / Pages | 宿主工具栏更新；重绘和响应式尺寸独立记录 | PDF 不反色；Pages 保持 digest-bound 原字节和 opaque sandbox，不注入主题 CSS |

## 存量例外与门禁

[visual-debt-ledger.json](../../scripts/visual-debt-ledger.json) 按文件、规则、节点指纹登记 owner、reason、exit 和数量。它独立于既有 [warning 基线](../../scripts/lint-warning-baseline.json)，不关闭目录。登记债务不等于宣布其交互通过；已迁移真实控件、功能面和宿主由 E2E 单独验收。

`check:visual-contracts` 拒绝新增指纹、数量增长和失效例外。四域共用 AST a11y/style/role 规则；className、cn/cva、模板、style 和 CSS 的全局/局部堆叠分别约束。局部名字保持原整数顺序；portal 相对父层级上移，测试点击、Esc 和恢复。`check:themes` 检查生成物及 motion TS/CSS parity。

## 设计决定

保留 40px 侧栏、840px 阅读列与当前材质；触摸目标仍为两维 44px。32/34px、768px 和增强高程进入可交互对照包，未作为正确性修复直接推广。阅读 scale、UI scale、旧根字号与实际 Chromium zoom 分别验证。

## 发布与回滚

1. 执行 theme-foundation、theme-contract、theme-roles、theme-domains、theme-browser-host、theme-login、theme-design、theme-governance；原生入口和正式包另跑宿主矩阵。VerificationRun 使用独立目录，不覆盖冻结证据。
2. definition、resolver、生成 CSS、role/utility adapter、host adapter 与 registry 同版本提交。builtin ID 和旧 `fontSize` / density 保持兼容；本轮无存储 schema 迁移，也不重写作者文件。
3. 回滚整个主题契约批次，再跑 `theme:generate`、`check:themes` 与偏好/重连/文件编辑 smoke；不只回滚 compiler 或 CSS 一半。配置通过原子偏好 API 恢复，不删除主题目录。
4. 保留上一正式包的样本、source/build hashes、平台信息、截图、诊断和 SHA。Windows/macOS/Linux、原生材质、实机软键盘和签名安装器分别登记；缺产物的场景仍 open。
