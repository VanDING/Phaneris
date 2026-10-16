# 第二轮治理：修复前失败矩阵

Status: accepted — 2026-10-16 用户确认整体计划后、产品修改前建立。基线 `02ecdea220195d0af4a1f2882fee7f20286b6260`。对应[实施计划](../process/project-governance-round2-plan-2026-10-16.md)。

| 场景 | 失败条件 / 验收契约 | 验证入口 |
| --- | --- | --- |
| M01 | 同一来源同配置并发启动多个 stdio 进程；完成后必须只有一个，全部断开后 PID 均退出 | round2 services，真实协议子进程 |
| M02 | 连接中 disconnect / disconnectAll 后，晚到连接回填；断开返回后必须无连接、无存活夹具进程 | 同上，延迟握手 |
| M03 | 不同来源被全局串行化、一个来源断开影响另一个；两来源必须在释放共同握手屏障前都启动 | 同上，两个来源 |
| M04 | 旧配置初始化后覆盖新配置；并发配置切换必须最终使用后调用配置，旧进程退出 | 同上，原配置/环境分别标识 |
| M05 | 失败目录读取遗留进程或污染池；必须拒绝、回收，下一次正确连接可以成功 | 同上，失败协议响应 |
| M06 | 首次目录拉取重复；每次成功连接只请求一次 tools/list，后续显式 listTools 仍读新目录 | 真实 HTTP MCP；同时保留健康检查错误 |
| M07 | disconnectAll 返回后不能复用池；显式新连接仍可成功，并在退出时回收 | 同上 |
| M08 | API in-process 连接绕过生命周期；同一 server 并发只初始化一次，断开中初始化不得回填 | 同上，真实 SDK in-memory transport |
| P01 | 并发首次 CREATE_LEASE 丢失新 lease；双 WS 客户端的八个 lease 均能执行已授权夹具动作 | round2 services，生产 RPC、grant、API executor |
| P02 | 不同工作区共用 broker、释放失效或 nonce/replay/grant 检查失效；原错误必须保留 | 同上 |
| P03 | broker 创建失败后永久缓存拒绝；重试应允许正常创建 | 同上，受控初始化错误 |
| F01 / F02 | A→B，A 的旧成功/旧失败覆盖或清空 B 列表及 atom | round2 renderer，真实 React/Jotai/hooks，受控 host 响应 |
| F03 | 同工作区两次刷新逆序响应，旧数据覆盖最新刷新；三类列表均应采用后发请求 | 同上 |
| F04 | Pages/Projects 推送已更新，旧读取又覆盖；收到推送必须作废先前读取 | 同上 |
| F05 | 清空工作区后仍保留 Automations；三类列表和 atom 均应为空 | 同上 |
| F06 | 组件卸载/重新挂载后，旧组件异步出口污染新组件的共享 atom | 同上 |
| F07 | Pages 工作区 id/slug 不同形式通知丢失；必须沿用既有重读兼容行为 | 同上 |
| F08 | 本地 RPC 的 Pages/Projects/Automations 读取或变更推送不能驱动现有 hooks | round2 renderer，真实本地 WS/RPC 数据与延迟响应 |
| T01 | bundle 成功标记后立即删 cwd，仍活着的进程占用目录；必须等 close 再结算 | 既有真实 bundle smoke，多次运行 |
| T02 / T03 | bundle 提前退出、spawn 失败、超时或多次标记导致重复结算/尾随进程；失败保留原错误且有界结束 | 既有 driver 的受控子进程出口，先列场景后修 helper |
| C01 | 首屏改善仅来自缓存/版本或 profiler；固定构建并保留配对原始数据，一批最多三组 | 既有 performance runner 与单组诊断 |
| C02 | 仅延长 Pages 测试截止隐藏卡顿；先独立编译测阶段、子进程退出，再决定局部改动 | 合成 scaffold 与既有编译测试 |

补充旧 M01–M03、原 19 场景及既有 33 场景的相关回归。产品修改后不追加镜像实现的单元测试；新增场景采用真实 RPC/浏览器/子进程。未能安全触发的场景明确标注限制，不声明通过。
