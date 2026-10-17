# CI 修复失败场景（2026-10-16）

基准：本地 `231a7942b`；远端失败运行：[38677812473](https://github.com/VanDING/Phaneris/actions/runs/38677812473)。

实施前确认以下失败路径；优先复用真实构建、现有工作流和完整测试，保留日志及结果清单。

| 场景 | 失败条件 | 验证 |
| --- | --- | --- |
| 日志管道 | 测试失败被 tee 的成功退出码覆盖 | 显式 Bash pipefail；工作流负向变体验证 |
| 原生构建 | 未使用的 unzipper S3 入口强制解析未安装的可选 AWS SDK | 空缓存独立安装后的真实 main 构建；三平台 CI |
| 容器安装 | node-pty 从源码构建时缺 Python、make 或 C++ 编译器 | Docker 输入负向变体；真实 Linux image 构建及 RPC/Pi 验收 |
| 原生浏览器 | Linux Electron 没有 DISPLAY，报告尚未生成就读取 | Xvfb 执行关键工作流；先断言进程成功并保留 stderr |
| Linux 脚本隔离 | bubblewrap 未安装，或 runner 的 AppArmor 限制用户命名空间 | CI 配置沙箱环境；原有 transform_data 集成用例 |
| Linux 临时目录挂载 | 在会话 bind mount 后挂载空 /tmp，遮住脚本、输入和输出 | 先挂载系统临时目录，再挂载会话；原有 transform_data 两个成功用例 |
| 环境隔离用例 | Node 测试继承 setup-uv 的 UV_CACHE_DIR | 用显式空基底测试“不新增 Python 变量”；同时验证生产环境原语 |
| Windows 路径用例 | 在 Linux 上要求 Windows 的大小写语义 | 将 Windows 专属断言限于 Windows；其他路径断言保留 |
| Windows 生命周期夹具 | child.kill(SIGTERM) 强制终止进程，绕过优雅停机处理并返回 null | 仅在测试 preload 中传入停机消息，触发相同 SIGTERM 处理；真实进程验证仍要求退出码 0 |
| Pi 故障注入时序 | 固定等 500ms 后进程仍在加载，故障未进入被测全局处理器 | 等待真实 Pi 启动标志后注入；超时或提前退出仍失败 |
| 安全门禁 | proxy-addr 和 source-map-js 的已修复漏洞仍锁定旧版 | 官方公告；定向更新兼容锁版本；真实 bun audit；不扩充允许基线 |
| 证据 | 构建在验收启动前失败，上传目录为空 | 提前初始化证据并捕获构建日志；保留缺证据即失败 |
| 范围 | 已有用户改动或六个未推送提交被意外合入本次提交 | 记录开始时状态；只暂存本任务文件；发布前明确提交范围 |

## 2026-10-17 远端第二轮

运行 [38933656894](https://github.com/VanDING/Phaneris/actions/runs/38933656894)，源码 `38389be15`。以下场景在本轮修改前列出：

| 场景 | 观察 / 待验证判断 | 验证要求 |
| --- | --- | --- |
| Linux 网络隔离 | 非特权 runner 无法直接 unshare -n；仅安装 bubblewrap 不会启用现有网络包装 | bubblewrap 同时隔离网络与文件系统，保留真实执行、越界与网络拒绝验收；不放开脚本网络 |
| Linux 截图夹具 | 真实分支调用 getBounds / setPosition / setBounds / setSkipTaskbar / screen，而旧 mock 缺失 | 补齐既有夹具并运行原有截图恢复断言；不跳过 Linux |
| 集合切换 | React 尚未提交新 workspace 时旧快照 loading=false，使等待提前结束 | 等待目标 workspace 的已提交快照与读取结束，再验证旧读写无法污染新范围；保留原断言 |
| macOS 原生会话 | 截图显示 spawn bun ENOENT；登录 shell 的 PATH 覆盖继承的 setup-bun 路径 | 保留启动环境的工具路径；真实 main/preload/renderer/Pi 完整会话验收 |
| 容器停机 | RPC、Web UI、Pi 均通过，停止后 ExitCode=1；待排查 bun run 包装层及清理错误 | PID 1 直接运行 Bun 服务，保留原退出码 0 要求；失败时仍采集完整容器日志 |
| Windows 构建 | 输出 chunk 清单后无构建完成标记，40 分钟超时；待核实运行器与管道 | 显式 Node 执行 Vite，实际构建与原生主题验收；不以延长超时或忽略失败解决 |
| Windows WebUI 文件验收 | 完整会话已通过，但以 split('/') 从本地路径取文件名，导致 Windows 等待完整路径文本而超时 | 使用平台路径 basename；复跑真实 WebUI、Pi 写文件与文件树打开验收 |
| 重连在途请求 | WebUI 完整复验偶现未捕获 Connection lost，原错误栈只指向传输层 | 保留拒绝行为和错误断言；在错误栈标识 RPC channel，定位具体调用方并复验 |
| 容器绑定策略 | 完整日志确认默认 0.0.0.0 无 TLS 被产品策略拒绝；PID 1 调整不是本次退出 1 的根因 | 仅在回环端口映射的验收启动中显式 --allow-insecure-bind，不修改生产默认策略 |
| macOS 窄窗口 | 完整会话现已通过；420px 阶段仍保留 800px 的原生下限 | 对 Playwright page 对应的 BrowserWindow 设置非零最小尺寸，记录每次原生尺寸与视口，仍要求实际 420px |
| Linux 私有临时目录 | bwrap 为会话创建的 /tmp 父目录仍可写，越界脚本写入私有影子目录后返回成功 | 挂载完成后将 /tmp 设为只读；会话 data/.tmp 保持可写，原有越界与成功执行用例均须通过 |
| Select 连续键盘验收 | TF12 在菜单卸载后立即按 Space，Radix 的异步焦点恢复尚未完成，暗色模式二次打开超时 | 等待焦点实际返回触发器后再按键；仍检查键盘打开、选择、主题门户和 Escape 恢复 |
| Windows 原生日志管道 | 1f87d6d73 同样停在 renderer chunk 输出后，22 分钟未结束；本机 PowerShell 完整原生验收通过 | Windows 使用原生 PowerShell Tee-Object 并显式传播 LASTEXITCODE；macOS/Linux 保持 Bash pipefail；真实 Windows Actions 确认 |
