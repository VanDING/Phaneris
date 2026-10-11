# 主题引擎与前端视觉审计：失败矩阵（2026-10-12）

这份矩阵先于本轮新增审计探针编写。任务是独立审计与治理规划；本轮不修改产品实现。探针应记录现状，包括失败现状，而不是把发现的问题变成“应当长期保持”的回归断言。

## 证据有效性

| ID | 可能失败的方式 | 检查与产物 |
| --- | --- | --- |
| E01 | 把 HEAD、暂存区或旧构建当成当前产品 | 记录 HEAD、工作树状态摘要、被扫描源码 SHA-256；直接从当前源码启动 Vite |
| E02 | 原报告的正则命中被当成 lint 违规或组件覆盖率 | 分开记录词法候选、AST 原生元素数量、有效 ESLint 配置、浏览器实测；明确分母和排除范围 |
| E03 | 演示、测试、注释、静态图标颜色混入产品债务 | 清单分生产、playground、测试；颜色匹配只作候选，不作缺陷总数 |
| E04 | 加载中、字体未就绪、动画中途截屏 | 等待 fixture readiness、document.fonts.ready 与主题稳定；记录浏览器版本、viewport、DPR、媒体偏好 |
| E05 | mock 主题链路冒充真实文件 watcher / Electron / WebSocket 验证 | 标明 harness 边界；本轮浏览器组件验证与后续真实宿主 E2E 分开 |
| E06 | 透明表面、color-mix、广色域值按字符串或原始 RGB 误算对比度 | 浏览器求实际颜色，转 sRGB；透明色按实际底面合成；记录样本和阈值适用语义 |
| E07 | 截图被误当成交互正确性证据 | 同时保存 DOM computed style、主题状态、键盘焦点、几何数据和 pageerror |
| E08 | 审计改变用户配置、现有改动或历史验收记录 | mock bridge、独立 .cache 入口和新结果目录；新增审计文件并登记索引，不改产品与历史记录；校验源码摘要 |
| E09 | 重跑覆盖本次点时刻证据 | 默认写入 .cache；只有显式 --output 才写指定目录；归档 README 与 SHA256SUMS |

## 本轮浏览器探针覆盖

| ID | 可能失败的方式 | 检查与产物 |
| --- | --- | --- |
| B01 | 内置主题明暗切换、单模式强制与回退不同步 | Default / Geek / Cyberpunk / Ink，记录 requested/applied/status、DOM class、模式与 token |
| B02 | A→B 快速切换被 A 的迟到结果覆盖 | 可控延迟 loader，记录中间 last-good 与最终 applied |
| B03 | 丢失/拒绝加载后残留上个主题 CSS 或背景图 | null/rejected loader，检查 Default 回退与 overrides 清理 |
| B04 | app/workspace/preview 优先级混淆，退出预览不恢复 | 改变各层选择并记录优先级；验证 preview 清除后的实际主题 |
| B05 | 主题偏好保存失败后缓存和 DOM 不一致 | 可控失败 bridge，检查回滚与 error 状态 |
| B06 | root 默认环关闭使原生按钮失去焦点可见性 | 键盘 Tab；对比原生按钮和现有 Button/Input/Select，查自身或包装层 outline/box-shadow |
| B07 | shadow 别名自引用在编译后失效 | 同时读取 shadow-xs/sm/md 和语义 shadow-minimal 的 computed box-shadow |
| B08 | 同一派生色阶、圆角、图标、状态 token 在不同 CSS 宿主不一致 | Electron / 共享 UI / Viewer 实际 CSS 入口，相同 DOM 样本取值 |
| B09 | 内置主题或状态按钮的文字对比不足 | 按实际 Button、强调色控件、正文和提示语的前景/底面组合记录，不把装饰分割线套用控件 3:1 |
| B10 | root fontSize、density 改变导致图标、间距和触摸目标误缩放 | 15→18px 与 compact/comfortable/cozy 对比真实控件几何 |
| B11 | reduced motion 不生效或状态终态消失 | emulate OS reduce；取 motion duration、实际 animation/transition 和终态 |
| B12 | coarse pointer 下仍有过小目标或 hover-only 操作 | 比较真实 Button/Icon、菜单和包装层几何；不拿 svg 图形尺寸当点击目标 |
| B13 | forced colors 下焦点或状态不可辨 | emulate forced-colors；记录实际焦点和控件边界 |
| B14 | schema 接受无效 CSS、错误维度、透明 popoverSolid 或无效 Shiki | 产品 schema + 浏览器有效性探针；保存输入、校验结果、实际应用结果 |
| B15 | 主题切换只改根变量、已打开 portal / SVG / code viewer 保留旧视觉 | 打开真实菜单再切换；核对 portal 继承；先测独立 CodeBlock，再以实际 Viewer App + 合成 session 检查 MutationObserver 与 memoized Markdown 的影响；SVG 深度场景列入后续真实宿主矩阵 |
| B16 | WebUI 的 API 晚于 ThemeProvider 安装，首次读取与订阅永久缺失 | 按当前启动顺序延迟安装 bridge，再推送偏好变更；检查持久主题与订阅数量 |

## 全面治理必须补齐的宿主 E2E（本轮不声称已通过）

| ID | 可能失败的方式 | 后续验收要求 |
| --- | --- | --- |
| H01 | 冷启动先闪错误主题，重启后偏好丢失 | 临时 profile 中启动正式打包客户端，保存→退出→重启录像与逐帧主题采样 |
| H02 | 多窗口、workspace 切换、WebUI reconnect 导致偏好乱序 | 同时开两个窗口/客户端，保存与断线重连；记录 revision、最终状态和事件 |
| H03 | 用户主题文件写到一半、删除、rename、watcher 停止触发 | 临时 themes 目录中原子替换/非原子写入/删除/损坏/恢复；记录加载诊断和恢复行为 |
| H04 | scenic 图片损坏、缺失、跨路径、网络失败或图片过大 | 本地与远程失败注入；检查可读回退、主题诊断、解码负载、背景清理 |
| H05 | macOS vibrancy、Windows 标题栏、Linux 无材质与浏览器原生视图不一致 | 三平台截图，桌面 OS 明暗 × app 明暗；浏览器工具栏/空态/原生 overlay 同步 |
| H06 | WebUI 120% zoom、窄屏、软键盘、safe-area 或 iframe 改变布局 | 真实移动浏览器/触摸设备，375/390/768/769 宽度、横屏与软键盘；记录 viewport 与 CSS 像素 |
| H07 | Pages iframe、文档/代码/Mermaid/终端/PDF 各自拥有不兼容主题 | 定义宿主 UI 与用户内容边界后分别验收；不强改用户创作内容 |
| H08 | 缩小行高/内容宽度破坏中文、长文本、表格或多行信息 | 中英、长标题、混合代码、长路径、表格、200% 缩放、320px reflow；截图与可操作性 |
| H09 | modal / dropdown / tooltip / island / native BrowserView 交互遮挡 | 嵌套打开、Esc 顺序、焦点恢复、点击命中；不能仅比较全局 z-index 数值 |
| H10 | token 迁移造成主流程性能回退或清掉自定义主题兼容性 | 切换主题性能 trace、长会话滚动、前后截图；旧主题兼容迁移和 rollback |
| H11 | CI 只跑静态检查，视觉/可达性回归无法阻挡 | 关键跨主题 E2E 接 CI，失败上传截图/trace/JSON，基线变更必须人工评审 |

优先级和确认状态以配套审计方案及本次 JSON 结果为准。截图审阅与设计选择不自动升级为运行时缺陷。
