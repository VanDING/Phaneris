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

## 2026-10-23 Default 收敛

产品目录仅保留 Default，旧 app / workspace 选择统一回到 Default，明暗与字体偏好继续独立持久化。用户主题文件保留且不可选择。内部 schema、compiler 与 host snapshot 协议继续兼容。

Default 颜色与批准的 Run 视觉协调。静态 CSS、启动/失败回退、运行时 compiler 与对比度门禁共用 `theme-color-policy.ts`：原色先测、按需做最小文字调整；八种承载面及 20% 状态底覆盖 4.5:1。图标使用原色，四种实底分别拥有 on-color。算法版本参与 revision，避免样式或代码缓存复用旧策略。历史验收不能代替本轮证据，见[本轮失败矩阵与记录](../verification/default-theme-refinement-2026-10-23.md)。

## 存量例外与门禁

[visual-debt-ledger.json](../../scripts/visual-debt-ledger.json) 按文件、规则、节点指纹登记 owner、reason、exit 和数量。它独立于既有 [warning 基线](../../scripts/lint-warning-baseline.json)，不关闭目录。登记债务不等于宣布其交互通过；已迁移真实控件、功能面和宿主由 E2E 单独验收。

`check:visual-contracts` 拒绝新增指纹、数量增长和失效例外。四域共用 AST a11y/style/role 规则；className、cn/cva、模板、style 和 CSS 的全局/局部堆叠分别约束。局部名字保持原整数顺序；portal 相对父层级上移，测试点击、Esc 和恢复。`check:themes` 检查生成物及 motion TS/CSS parity。

## 设计决定

W1–W5 治理阶段保留 40px 侧栏和原材质，另提供参数对照。2026-10-12 按用户提出的可见 UI 微调，展开导航改为 28px 行、默认宽 200px，收起栏为 48px。后续用户选择两态共享紧凑间距：普通行与新建会话默认同为 28px，两态行间距均为 2px；收起按钮为 28px 正方形、两侧各 10px。图标列在两态和过渡中保持同一横坐标；按钮 DOM 保留，宽度、标签透明度和底部控件使用既有空间过渡节奏。新建按钮与导航列表一起上移首行的中心内距（默认 4px），新建按钮顶线与面板上沿对齐，底部控件保持锚点。字号/密度变大时，主导航行槽保留相同中心，图标按钮仍保持正方形。系统减弱动态偏好关闭空间过渡。失败场景见[状态过渡矩阵](../verification/sidebar-style-transition-failure-matrix-2026-10-12.md)，首批 [UI 档案](../verification/results/frontend-shell-polish-2026-10-12/README.md)保持冻结。

Default 浅色使用中性边框和轻阴影。触摸导航保留两维 44px，图标栏为 60px。macOS Default 的内部面板角为 10px、贴窗口底角为 8px；Windows Default 保持 6px，自定义主题使用作者的 radius。阅读列仍为 840px。启动层等待持久偏好、工作区选择、主题快照及字体就绪，避免先露出缓存尺寸再缩小；读取或编译失败仍允许可用快照/Default 回退。初轮失败场景见[外壳微调矩阵](../verification/frontend-shell-polish-failure-matrix-2026-10-12.md)。

## 发布与回滚

侧栏与 navigator 共用画布边缘，额外间隙为 0；navigator 与内容面板之间保留 6px。收起栏的可见宽度因此与声明宽度一致，图标按整条可见栏居中。两类 resize sash 的位置使用对应间隙，拖拽按起始宽度与鼠标增量计算，避免接缝宽度引起跳位。

1. 执行 theme-foundation、theme-contract、theme-roles、theme-domains、theme-browser-host、theme-login、theme-design、theme-governance；原生入口和正式包另跑宿主矩阵。VerificationRun 使用独立目录，不覆盖冻结证据。
2. definition、resolver、生成 CSS、role/utility adapter、host adapter 与 registry 同版本提交。builtin ID 和旧 `fontSize` / density 保持兼容；本轮无存储 schema 迁移，也不重写作者文件。
3. 回滚整个主题契约批次，再跑 `theme:generate`、`check:themes` 与偏好/重连/文件编辑 smoke；不只回滚 compiler 或 CSS 一半。配置通过原子偏好 API 恢复，不删除主题目录。
4. 保留上一正式包的样本、source/build hashes、平台信息、截图、诊断和 SHA。Windows/macOS/Linux、原生材质、实机软键盘和签名安装器分别登记；缺产物的场景仍 open。
