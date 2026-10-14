# 任务

Task 用 `task.yaml` 把目标拆为有依赖关系的子会话 DAG。它可以保存、编辑、校验并多次运行，适合明确分工、需要汇总和验收的工作。

## 创建不等于执行

可以描述目标让编排会话生成定义，也可以直接编辑 YAML。生成后先阅读目标、权限、依赖、预算和验收条件，再启动。编排会话与子会话通过持久字段和任务标签关联。

```text
<工作区>/tasks/<slug>/
  task.yaml
  runs/<runId>/
    run-log.jsonl
    nodes/<id>.json
```

新运行的权威执行事实在 Runtime 数据库中；这些文件是兼容记录和输出投影，不应与 Runtime 争夺状态权威。

## 当前可执行的定义

当前执行器只运行 `kind: session` 节点，支持 `depends_on`、输入引用、模型/连接选择、显式权限、已有 Token 预算、有限的错误重试，以及由编排者驱动的验收/修复循环。

历史字段能被解析，不表示已经实现。`approval`、条件/路由、通用 loop、map、replicas、多种聚合/校验节点及其他被标为 unsupported 的控制语义，会在执行前被拒绝。不要用 `approval: true` 代替真实审批流程。

## 显式权限与文件范围

```yaml
id: report
title: 准备报告
goal: 审阅资料并生成结论
defaults:
  permissionMode: safe
cwd: /absolute/path/to/materials
max_parallel: 2
nodes:
  - id: inspect
    prompt: 阅读资料并给出审阅意见
    file_scope:
      read: [inputs]
      write: []
  - id: draft
    permissionMode: ask
    prompt: 根据 ${nodes.inspect.output} 编写报告
    depends_on: [inspect]
    file_scope:
      read: [inputs]
      write: [report.md]
```

任何节点缺少节点级或默认的 `permissionMode`，整个任务都在子会话派发前拒绝。显式 `allow-all` 是用户选择，缺省不能自动升级。

`file_scope` 使用相对于本次工作目录的具体文件或目录路径，不使用 glob。读写相交的节点串行，明确只读和互不相交范围可以并行；未声明时按共享目录可写保守处理。路径比较考虑父子目录、Windows 大小写及可解析链接别名。

范围是单 Host 下 TaskRunner 的调度契约，不是 OS 沙箱，也不能约束违背声明的独立代理或其他程序。节点仍须遵守现有权限规则。恢复旧运行时不能修改已冻结的范围或目录来绕过冲突；需要修改应开始新运行。

## 运行、预算与恢复

Run 可查看子会话、输出、终态、已有预算用量及未决效果。Token 达到预算后按执行器规则暂停或失败；`max_no_progress` 约束的是失败验收循环，不是一般工具循环的自动判定。

重启会读取持久事实。已确定完成且输出可用的节点可复用；运行中或外部效果未知的节点不能盲目重放，应先核查。规范改变影响后续新运行，历史记录保持原样。

## 下一步

- [权限](phaneris://docs/core-concepts/permissions)
- [看板](phaneris://docs/go-further/kanban)
- [会话](phaneris://docs/core-concepts/conversations)
