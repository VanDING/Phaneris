# 主题治理 W1：事先失败矩阵

- 范围：审计 F01/F02/F03，以及启动和重连所需的偏好读取。
- 编写顺序：本矩阵与浏览器工作流先于产品修复；修复前后分别生成独立产物。
- 责任：本分支由 Codex 实施；主题与配置、共享 UI、client platform 的职责沿用治理方案 §8.3。

| 场景 | 可能失败的方式 | 阻挡断言与证据 |
| --- | --- | --- |
| TF01 | API 配置延迟时 Provider 提前挂载、写入 Default 缓存 | 新浏览器无主题缓存；延迟真实 `/api/config`，ready 前没有主题 Provider 的 DOM 标记与缓存 |
| TF02 | 无 localStorage 的 WebUI 冷启动不读取持久主题 | 真实服务器临时 config 中 Geek；生产 WebUI 必须应用 Geek、dark 和 ready |
| TF03 | 已过期的 v3 浏览器缓存覆盖服务器偏好 | 新客户端预置 Ink/light 缓存；最终与服务器 Geek/dark 一致 |
| TF04 | 跨客户端事件未订阅或只同步颜色 | 两个真实认证浏览器上下文；经 RPC 修改 mode/colorTheme/font，两个 DOM 与 config 一致 |
| TF05 | 离线期间丢失的事件在重连后永不补读 | 关闭真实浏览器网络、重连旧 socket；另一客户端修改偏好；恢复网络后重连并恢复服务器最新值 |
| TF06 | 重连重复订阅或后续事件失效 | 重连后再修改偏好，两个客户端均收敛；RPC/连接轨迹与 pageerror 归档 |
| TF07 | 刷新页面又退回 Default | 偏好持久化后刷新，主题、mode、font 仍符合服务器 config |
| TF08 | 初始化失败后重试仍使用缺失/旧 API | 首次 config 500；键盘触发真实重试按钮，成功连接后应用持久主题 |
| TF09 | 未声明角色的按钮/链接/可编辑控件无焦点 | 四个实际 CSS 入口 × light/dark，Tab 和 Shift+Tab 后 focus-visible 且有可见 outline |
| TF10 | 默认规则覆盖共享控件或造成输入双环 | 真 Button/Input、craft-field-surface；环只在指定自身/包装层，主题色有效 |
| TF11 | inset 列表环被 overflow 裁切 | 现有 craft-row-focus 角色在 overflow:hidden 容器内；环宽 2px、offset 为负，几何留在可见区域 |
| TF12 | Select 门户键盘、Esc、焦点恢复失效 | 真 Select 通过键盘打开/选择/退出，焦点回 trigger；打开期间切 mode，门户颜色随根状态更新 |
| TF13 | shadow 别名仍为 none、自引用或忽略 depth | 2xs/xs/sm/md/lg/xl/2xl × light/dark × 五种 depth × 四个入口；computed shadow 合法，符合语义高程映射 |
| TF14 | hover shadow 失效或覆盖原有语义阴影 | 实际鼠标 hover 切换 xs→md；与对应语义阴影 probe 相同，语义配方不改强度 |
| TF15 | forced-colors 只保留共享角色的环 | 四入口模拟 forced-colors，原生按钮与共享控件焦点可见，记录 computed colors |
| TF16 | 窄屏/缩放使焦点越界或键盘流程变化 | 390px 与 root18px；原生/共享控件键盘可操作，inset 环未裁切 |
| TF17 | 迟到偏好读覆盖新事件/本地保存，重连重复迁移旧缓存 | 请求 generation 保留；真实重连后以服务器值为准；既有生命周期审计按新基线重跑 |
| TF18 | 未完成验证却被登记为成功或覆盖旧证据 | VerificationRun 独占目录；失败非零退出；manifest、源码/构建摘要、截图、trace 与 SHA-256 校验 |

本轮真实 WebUI 使用生产 bundle、实际认证 HTTP/WebSocket、临时磁盘配置，未替换主题 RPC 或事件。控件样本使用真实 CSS、resolver 与生产组件；主题内容为合成输入。未覆盖正式 Electron 包、原生材质、macOS/Linux、本机触摸设备和移动 Safari，保留为后续宿主验收。

执行中补充的夹具条件：旧 markdown-popout HTML 没有声明 favicon，Edge 会主动请求 `/favicon.ico`，18 项行为全部成功仍会被该 404 触发 console gate。指定空 data favicon 消除未声明资源请求；保留原有 0 console error 断言，并重新执行完整卡片回归。
