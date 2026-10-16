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
