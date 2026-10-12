# 主题治理 W2–W5：实施前失败矩阵

接续 `7891559` 的治理规划和 W1。以下要求先于本轮产品修改记录；验收使用真实入口 CSS、ThemeProvider 和 Viewer，合成 bridge/会话的边界随产物公开。

| ID | 失败方式 | 验收与证据 |
| --- | --- | --- |
| TC01 | 不同入口的色阶、圆角、图标、形状映射分叉 | 四个实际 CSS 入口，同一内置主题/actualMode 下比较 computed style；生成 token 的字节一致性门禁 |
| TC02 | banana、错误维度、负尺寸、calc 负结果仍 ready | 浏览器目标属性语法和计算值验证；Default 回退、requested/applied 和逐字段 diagnostics |
| TC03 | var 存在但依赖缺失、循环或维度错误 | 在隔离的继承链和变量声明中验证，包括 fallback；合法现代颜色、calc、相对单位保留 |
| TC04 | transparent 或带 alpha 的 popoverSolid 泄漏底图 | 明暗模式分别检查实际 opacity；无效主题回退，原文件摘要不变 |
| TC05 | scenic 缺图、路径越界、损坏、网络失败仍健康 | schema 必填、存储路径限制、浏览器解码；超时/取消和恢复；失败清除背景 |
| TC06 | 任意 Shiki 名称只有渲染时才报错 | 以当前安装的 bundled registry 生成可用名称；加载阶段诊断 |
| TC07 | 内置主题文字在 paper、muted、popover、强调底面不可读 | 内置可用/强制模式，sRGB 合成，对正文/次要文字/状态文字分别测 4.5:1；必要图形 3:1，装饰不套用 |
| TC08 | Viewer memoized 转录和打开的代码 overlay 不更新 | 实际 App/SessionViewer/TurnCard，切换后无需点击转录；旧 HTML 立即失效，最终 Shiki 主题和 token 颜色更新 |
| TC09 | snapshot 的 DOM、Shiki、native 或请求代次不同步 | version/requestedId/appliedId/source/requestedMode/actualMode/status/revision/diagnostics/tokens/shiki；迟到加载不能覆盖新选择 |
| TC10 | 主题 A→B→A 缓存、watcher 或图片仍旧 | 只重载已选择的变化 ID；列表事件独立；内容 revision 改变后重新解码/高亮 |
| TC11 | icon Button 或 hover-only 控件在触摸/键盘不可操作 | 自动 icon 角色，两维 44px；focus-within/coarse 显示操作；disabled/loading/invalid 状态 |
| TC12 | 新角色破坏旧 rem/UI scale，中文或窄屏被裁剪 | 保留旧根字号；15/18px、320/375/390/768/769、200% 与长路径/表格；DOM 几何和截图 |
| TC13 | 转录与 composer 内容边不齐、嵌套圆角无归属 | 同一 gutter/reading-width；40/34/32、840/768 对照包；记录设计选择而不冒充缺陷 |
| TC14 | 外围宿主与第三方适配不同步或侵入用户内容 | 工具栏/空态/登录/代码/Mermaid/终端/PDF/Pages 独立 adapter；明确 host UI 与内容所有权 |
| TC15 | z 类/cn/cva/template/CSS 绕过门禁，局部堆叠被误迁移 | AST 与 CSS 覆盖四个消费域；全局与局部具名层级；嵌套 portal 点击/Esc/焦点恢复 |
| TC16 | blanket off 或 warning 基线吸收新债务 | 四个消费域有效配置；例外 owner/reason/exit；新增违规 mutation gate |
| TC17 | motion TS/CSS 与字段表/指南再次漂移 | manifest 生成、parity gate、critical registry/CI artifact 合约；旧主题兼容与回退说明 |
| TC18 | 测试或文档声称未经执行的正式包/平台验收完成 | source/build hashes、浏览器/OS/viewport、JSON/截图/trace；外部平台与实机软键盘单列 open |

Windows 分发校验路径分隔符及已有文档失效链接另外记录为既有门禁阻塞；修复时验证对应失败输入，不伪造缺失日志。
