# 上游修复吸收：实施前失败矩阵

状态：**实施前冻结记录；完成情况见[实施记录](upstream-bugfix-2026-11-17-implementation.md)**。日期：2026-11-17（Asia/Shanghai）。

用户已批准按[评估报告](../dependencies/upstream-bugfix-assessment-2026-11-17.md)实施F01–F08。基线 `43ee16f7b476c0403d93825c3dfd15bd35f74aca`／Phaneris 0.6.5；分支 `codex/upstream-bugfix-20261117`。本矩阵先于产品源码与新验收代码写入。

保留评估文档和另有的打包烟测结果更新；初始哈希与烟测副本保存在 `.cache/upstream-bugfix-implementation-20261117/`。不修改前端、新增功能、依赖、版本、用户配置或发布；C01云盘启动、C02 macOS HEIC及Claude认证路径不在实施范围。

| 编号 | 失败条件 | 验收方式／产物 |
| --- | --- | --- |
| BF01 | Rich描述注入后丢失strict schema，或rich关闭后仍改写 | 真实拦截器子进程→回环HTTP，Chat Completions／Responses、内建／MCP及嵌套对象；保存出站JSON |
| BF02 | prompt／labels／topic能展开进程秘密、webhook秘密或被shell转义；关闭一个入口仍有其他泄露入口 | 真实AutomationSystem与事件总线，用假秘密触发LabelAdd；保存交付的prompt／metadata |
| BF03 | 变量替换值再次展开；引号、换行、反斜杠破坏对象body；重试时再次替换；JSON键被污染 | 回环Webhook请求与延迟保存副本；字符串／数组／对象、美元符号、特殊键、重试；保存HTTP请求与动作副本 |
| BF04 | 错误matcher／action／regex／cron／条件拖垮有效项；部分重载不应用新有效项；非法JSON清空旧配置；scheduler错误启停 | 真实AutomationSystem、独立工作区文件和事件；严格写入继续拒绝坏配置；保存重载结果、事件与文件哈希 |
| BF05 | 没有上下文文件、兄弟目录多、先截断、缓存切目录导致当前指令丢失或引入无关文件 | 临时真实Git仓库→生产prompt编译，祖先／当前／后代、大小写、超过20个兄弟目录、无关目录、XML消毒；保存prompt |
| BF06 | scanner无边界、跟随目录链接循环、读隐藏／依赖／构建目录；软预算截断丢失已找到文件 | 真实文件树与scanner边界参数、depth／目录数／时间及目录链接；保存扫描结果，不将软预算称为单次I/O硬期限 |
| BF07 | git同步阻塞、detached HEAD返回HEAD、超时／错误抛出、含特殊字符路径成为shell命令 | 实际共享RPC handler注册后调用，临时Git仓库与有界慢git夹具；检查事件循环响应、正常／detached／非仓库／失败／超时；保存结果 |
| BF08 | 分支首条消息前重开越过anchor；之后反复fork覆盖子历史；父后续消息混入；父文件被修改 | 实际Pi subprocess JSONL协议＋真实SDK journal＋回环provider；首开／重开／新工具／父后续消息／子消息，保存journal和请求 |
| BF09 | 分叉anchor无效时留下可误认的子journal；缺父journal悄悄变成空会话；已有子journal仍依赖父文件 | 实际Pi subprocess分支预检及重开；保存错误、文件列表与父文件哈希 |
| BF10 | 工具更新先dispose而中断压缩／重试／流；等待期间Stop卡死；忙碌后永不应用工具 | 实际Pi subprocess与延迟回环摘要／重试／流响应；更新工具并提交后续prompt，验证旧请求完成、取消有界及下轮生效；保存协议与HTTP时间线 |
| BF11 | 延后工具重建让已撤销工具仍能执行；相同工具集合造成重建；Durable事实／账本因恢复重复 | 既有source settlement、Durable Pi和分支／压缩工作流；保存manifest、SQLite／journal与回环请求 |
| BF12 | 校验为容错加载放松、旧前缀／脚本环境被移除、agent-event自动化被意外启用 | 严格schema和真实automation事件／脚本流程、既有回归；文件不被无故重写，schema错误保持可见 |
| BF13 | 类型、lint、协议／身份／版本／文档回归；证据与最终源码不一致 | 在最终源码上运行适用门禁和生产内核构建；记录命令、退出码、源码及产物SHA-256 |

复杂流程先写验收再改产品代码，复用VerificationRun生成唯一目录与manifest。缺少真实账户、其他操作系统和签名安装器时明确保留未验证范围；不以此阻塞本轮独立修复，也不宣称已通过。
